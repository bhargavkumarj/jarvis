import { accountFor, contentFailure, databaseResult, ContentError, contentBody } from "@/lib/conversation/api";
import { turnSchema } from "@/lib/conversation/validation";
import type { Turn, MemorySnippet, StreamEvent } from "@/lib/conversation/types";
import {prepareLive,safeRecentHistory,runLive} from "@/lib/ai/orchestrate";
import {liveFailureMessage} from "@/lib/ai/errors";
import { mockProvider } from "@/lib/conversation/provider";
import { boundedContext, explicitMemory } from "@/lib/conversation/mock-rules";
import { parseRecurringRequest } from "@/lib/reminders/recurrence";
import { reviewSeries } from "@/lib/reminders/series-service";
import { parseReminderCommand, ScheduleError } from "@/lib/reminders/time";
import { reviewReminder } from "@/lib/reminders/service";
import {parseTaskChat} from "@/lib/tasks/chat-plan";
import {forgetGuidance} from "@/lib/privacy/model";
import {loadTaskContext,taskChat} from "@/lib/tasks/chat";
import {readLiveConfig} from "@/lib/live/config";
import { encodeEvent } from "@/lib/conversation/sse";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let claimed: Turn | undefined;
  let client: Awaited<ReturnType<typeof accountFor>>["client"] | undefined;
  try {
    const account = await accountFor(request, true); client = account.client;
    const input = turnSchema.safeParse(await contentBody(request, 24576));
    if (!input.success) throw new ContentError(422, "Use a message up to 2,000 characters and a valid conversation/request ID. Temporary mode accepts no saved conversation or memory fields.");
    const v = input.data;
    const taskCommand=parseTaskChat(v.text);const forget=forgetGuidance(v.text);
    let live: Awaited<ReturnType<typeof prepareLive>> | null = null;
    let memories: MemorySnippet[] = [], history: { user_text: string; assistant_text: string }[] = [];
    let replay = false;
    if (v.mode === "retained") {
      const start = databaseResult<{ turn: Turn; acquired: boolean }>(await client.rpc("m2a_start_turn_v1", { p_conversation: v.conversation_id, p_request: v.request_id, p_text: v.text }));
      claimed = start.turn; replay = !start.acquired;
      if (!replay) {
        memories = databaseResult<MemorySnippet[]>(await client.rpc("m2a_retrieve_v1", { p_query: v.text }));
        const rows = databaseResult<{ user_text: string }[]>(await client.from("messages").select("user_text").eq("owner_id", account.profile.owner_id).eq("conversation_id", v.conversation_id).eq("state", "complete").eq("memory_suppressed",false).order("created_at", { ascending: false }).limit(6));
        history = rows.reverse().map((r) => ({ user_text: r.user_text, assistant_text: "" }));
      }
    } else history = v.history;
    if(v.provider === "openai" && !replay && !taskCommand && !forget) live=await prepareLive(client,account.profile);
    if(live && v.mode === "retained" && !replay) history = await safeRecentHistory(client,account.profile.owner_id,v.conversation_id);
    const recurringCommand = !live ? parseRecurringRequest(v.text, account.profile.timezone) : null;
    const reminderCommand = !live && (/^\/remind(?: |$)/.test(v.text) || !!recurringCommand);
    if (reminderCommand||taskCommand||forget) memories = [];
    const context = boundedContext({ text: v.text, assistantName: account.profile.assistant_name, allowMemory: v.mode === "retained", memories, history });
    const localAbort = new AbortController();
    const signal = AbortSignal.any([request.signal, localAbort.signal, AbortSignal.timeout(30_000)]);
    const turn = claimed, db = client;
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        let closed = false;
        const emit = (event: StreamEvent) => { if (!closed) { try { output.enqueue(encodeEvent(event)); } catch { closed = true; localAbort.abort(); } } };
        try {
          if (turn) emit({ type: "start", id: turn.id, attempt: turn.attempt });
          if (replay && turn) {
            emit({ type: "delta", text: turn.state === "redacted" ? "Response removed after a memory correction or deletion. This completed request will not be regenerated automatically." : turn.assistant_text });
            emit({ type: "done", proposal_id: null, replay: true });
            return;
          }
          emit({ type: "memories", memories: context.memories });
          if(live){
            const result=await runLive({client:db,profile:account.profile,turn,request_id:v.request_id,text:v.text,history:context.history,memories:context.memories,signal,prepared:live,emit});
            if(result.receipt)emit({type:"receipt",text:result.receipt});
            // Replace previews with the committed complete text on reload. Tools
            // only propose; receipts are emitted after deterministic commits.
            if(!turn)emit({type:"receipt",text:"Temporary response: no application content was retained. OpenAI retention is a separate boundary."});
            emit({type:"done",proposal_id:result.proposal_id});return;
          }
          let text = "", success = false;
          if(forget){text=forget;emit({type:'delta',text});success=true;}else if(taskCommand){
            if(v.mode==='temporary')text='Task access and persistent task actions are disabled in temporary conversations. Open Today or a retained conversation. No task or reminder operation was created.';
            else if('clarification' in taskCommand)text=taskCommand.clarification;
            else {
              const plan=taskCommand.plan;
              const ctx=['create','list_overdue'].includes(plan.operation)?{candidates:[],focus:null,more:false}:await loadTaskContext(db,account.profile.owner_id,plan.reference??v.text,v.conversation_id);
              let channel:'mock'|'pushover'|null=v.provider==='mock'?'mock':null;
              if(plan.operation==='remind'&&v.provider==='openai'){
                const cfg=readLiveConfig();const caps=databaseResult<{pushover_enabled:boolean}>(await db.rpc('m2c_capabilities_v1',{}));
                if(cfg?.owner_id===account.profile.owner_id&&cfg.pushover&&caps.pushover_enabled)channel='pushover';
              }
              text='Deterministic task command (no model call).\n'+await taskChat({client:db,owner:account.profile.owner_id,request:v.request_id,text:v.text,plan,context:ctx,conversation:v.conversation_id,timezone:account.profile.timezone,channel,parsed:taskCommand});
            }
            signal.throwIfAborted();emit({type:'delta',text});success=true;
          } else if (reminderCommand) {
            const schedule = parseReminderCommand(v.text);
            if (v.mode === "temporary") text = "Temporary mode cannot save reminders. Open Today to review a retained reminder; confirming there creates persistent account data. No reminder draft or operation was created here.";
            else if (recurringCommand) {
              if(!recurringCommand.schedule) text = recurringCommand.clarification!;
              else {
                const receipt = await reviewSeries(db, v.request_id, recurringCommand.schedule,undefined,undefined,v.conversation_id);
                text = `Mock command receipt: recurring draft ${receipt.series.id}, operation ${receipt.operation.id}. Open Today → Review proposed series for exact dates, offsets, timezone and mock channel. Separate confirmation is required. No notification was sent and no series schedule was confirmed.`;
              }
            }
            else if (!schedule) text = "Mock reminder grammar: /remind YYYY-MM-DDTHH:mm[:ss] IANA/Zone [earlier|later] | title. Arbitrary natural-language dates are not understood. Open Today for the manual form. No reminder was created.";
            else {
              try {
                const receipt = await reviewReminder(db, v.request_id, schedule,undefined,undefined,'mock',v.conversation_id);
                const r = receipt.reminder;
                text = `Mock command receipt: draft ${r.id}, operation ${receipt.operation.id}. Review “${r.title}” for ${r.local_datetime} in ${r.timezone}; UTC ${r.due_at}, ${r.resolution}, mock channel. ${r.state === "draft" ? "Open Today → Review draft and confirm the exact values. This draft is not confirmed or scheduled." : "This earlier review already exists; no new reminder was created by retrying. Inspect Today."} State when this receipt was recorded: ${r.state}.`;
              } catch (error) {
                if (!(error instanceof ScheduleError)) throw error;
                text = `Reminder review rejected: ${error.message} No new reminder was saved for scheduling.`;
              }
            }
            signal.throwIfAborted(); emit({ type: "delta", text }); success = true;
          } else for await (const event of mockProvider.stream(context, signal)) {
            signal.throwIfAborted();
            if (event.type === "failure") throw new Error("Mock provider did not complete");
            if (event.type === "delta") {
              text += event.text;
              if (text.length > 8000) throw new Error("Output budget exceeded");
              emit(event);
            }
            if (event.type === "proposal" && (v.mode !== "retained" || event.content !== explicitMemory(v.text))) throw new Error("Invalid provider proposal");
            if (event.type === "success") success = true;
          }
          if (!success || !text) throw new Error("No completed response");
          signal.throwIfAborted();
          let proposal_id: string | null = null;
          if (turn) {
            // Only this deterministic commit creates a pending proposal. Provider
            // events never carry approval authority or an execution client.
            const committed = databaseResult<{ proposal_id: string | null }>(await db.rpc("m2a_end_turn_v1", { p_id: turn.id, p_attempt: turn.attempt, p_state: "complete", p_text: text, p_used: context.memories.map((m) => ({ id: m.id, version: m.version })) }));
            proposal_id = committed.proposal_id;
          } else {
            const stillActive = databaseResult(await db.from("profiles").select("owner_id").eq("owner_id", account.profile.owner_id).maybeSingle());
            if (!stillActive) throw new Error("Session no longer active");
          }
          emit({ type: "done", proposal_id });
        } catch (error) {
          if (turn) await Promise.resolve(db.rpc("m2a_end_turn_v1", { p_id: turn.id, p_attempt: turn.attempt, p_state: signal.aborted ? "cancelled" : "failed" })).catch(() => {});
          emit({ type: "failure", message: live ? liveFailureMessage(error) : taskCommand && v.mode === "retained" ? "The task response did not complete. A review may already exist in Today; inspect it. Retry keeps the same operation key. No chat proposal confirms a task change or notification by itself." : reminderCommand && v.mode === "retained" ? "The response did not complete. A review-only reminder draft may already have committed; inspect Today. Retry keeps its operation key. No scheduling occurs without your separate confirmation." : signal.aborted ? "Stopped or timed out. No complete answer was confirmed. Retry uses the same request ID." : "The selected provider response did not complete or could not be saved. Partial text was discarded. Reload or retry; no memory was approved." });
        } finally {
          if (!closed) { closed = true; output.close(); }
        }
      },
      cancel() { localAbort.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Accel-Buffering": "no" } });
  } catch (error) {
    if (claimed && client) await Promise.resolve(client.rpc("m2a_end_turn_v1", { p_id: claimed.id, p_attempt: claimed.attempt, p_state: "failed" })).catch(() => {});
    return contentFailure(error);
  }
}
