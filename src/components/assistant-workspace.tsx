"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Conversation, Turn, MemorySnippet } from "@/lib/conversation/types";
import { contentRequest } from "@/lib/conversation/client";
import { readEvents } from "@/lib/conversation/sse";
import { useHydrated } from "@/lib/use-hydrated";

import {VoiceInput} from "./voice-input";
import {ReadAloud} from "./read-aloud";
import {stopVoice} from "@/lib/voice/speech";
import {WORK_STOP_EVENT} from "@/lib/session-events";
import {historyPolicy, availabilityLabel, formatTimestamp, ViewGeneration, type Availability} from "@/lib/workspace";
import {useComputer} from "@/lib/computer/use-computer";
import {ComputerPlan, type ProposedCommand} from "./computer-plan";

type Pending = { text: string; request_id: string; conversation_id: string | null; temporary: boolean; provider: "mock" | "openai" };
type VolatileTurn = { user_text: string; assistant_text: string; provider?: "mock" | "openai" };
// Computer exchanges are shown inline but are not conversation messages; their durable record is Settings → Computer history.
type ComputerItem = { id: string; text: string; source: "text" | "voice" } & ({ kind: "note"; message: string } | { kind: "plan"; command: ProposedCommand & { device_id: string }; autoRun: boolean });
function isSavedTurn(value: Turn | VolatileTurn): value is Turn { return "id" in value; }
export function AssistantWorkspace() {
  const hydrated = useHydrated();
  const [provider,setProvider]=useState<"mock"|"openai">("mock");
  const [liveAvailable,setLiveAvailable]=useState(false),[liveModel,setLiveModel]=useState("");
  const [providerError,setProviderError]=useState("");
  const [retention,setRetention]=useState<number>(),[liveState,setLiveState]=useState<Availability|null>(null);
  const providerChosen=useRef(false),messageRef=useRef<HTMLTextAreaElement>(null);
  const [receipts,setReceipts]=useState<string[]>([]);
  const computer=useComputer(),voiceUsed=useRef(false);
  const [computerItems,setComputerItems]=useState<ComputerItem[]>([]);
  useEffect(()=>{let mounted=true;void fetch("/api/v1/integrations",{cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(!mounted)return;setLiveAvailable(data.openai_available===true);setRetention(data.retention_days);setLiveState(data.text_state??null);setLiveModel(data.model??"");if(data.openai_available&&!providerChosen.current)setProvider("openai");}).catch(()=>{if(mounted)setProviderError("Provider availability could not be checked. The selected mock remains local; reload to check live setup.");});return()=>{mounted=false;};},[]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyLoaded,setHistoryLoaded]=useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [temporary, setTemporary] = useState(false);
  const [volatile, setVolatile] = useState<VolatileTurn[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [used, setUsed] = useState<MemorySnippet[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("Loading conversations…");
  const abort = useRef<AbortController | null>(null);
  const sending=useRef(false);
  const view=useRef(new ViewGeneration()),openingLock=useRef(false);
  const [opening,setOpening]=useState(false);
  const active = useRef<{ id: string; attempt: string } | null>(null);
  const stopping = useRef<Promise<unknown>>(Promise.resolve());
  const errorRef = useRef<HTMLParagraphElement>(null);
  async function list(ticket?:number) {
    const data = await contentRequest<{ conversations: Conversation[] }>("/api/v1/conversations");
    if(ticket===undefined||view.current.current(ticket)){setConversations(data.conversations); setHistoryLoaded(true);}
  }
  useEffect(() => {
    let mounted = true; const scope=view.current,ticket=scope.next();
    const pause=()=>{scope.invalidate();abort.current?.abort();active.current=null;sending.current=false;openingLock.current=false;setBusy(false);setOpening(false);setPartial("");setUsed([]);setReceipts([]);setComputerItems([]);setPending(null);setNotice("Active work stopped after a session or privacy change. Refresh saved state before continuing.");};
    window.addEventListener(WORK_STOP_EVENT,pause);
    contentRequest<{ conversations: Conversation[] }>("/api/v1/conversations").then((data) => { if (mounted && view.current.current(ticket)) { setConversations(data.conversations); setHistoryLoaded(true); setNotice(""); } }).catch(() => { if (mounted && view.current.current(ticket)) { setError("Conversation storage unavailable. Existing history could not be checked. Reload when local services are available."); setNotice(""); } });
    return () => { mounted = false;scope.invalidate();abort.current?.abort();window.removeEventListener(WORK_STOP_EVENT,pause); };
  }, []);
  async function load(id: string,ticket:number) {
    const data = await contentRequest<{ messages: Turn[] }>(`/api/v1/conversations/${id}`);
    if(view.current.current(ticket)){setMessages(data.messages); setSelected(id);}
  }
  async function create(ticket:number) {
    const data = await contentRequest<{ conversation: Conversation }>("/api/v1/conversations", "POST", {});
    await list(ticket); if(!view.current.current(ticket))throw new DOMException("View changed", "AbortError");return data.conversation.id;
  }
  async function select(id: string) {
    if(openingLock.current||sending.current)return;
    openingLock.current=true;setOpening(true);const ticket=view.current.next();stopVoice();
    try { setError("");await load(id,ticket);if(!view.current.current(ticket))return;setTemporary(false);setVolatile([]);setPending(null);setReceipts([]);setNotice("Conversation opened.");requestAnimationFrame(()=>messageRef.current?.focus()); }
    catch { if(view.current.current(ticket))setError("Could not open this conversation. Reload or sign in again."); }
    finally{if(view.current.current(ticket)){openingLock.current=false;setOpening(false);}}
  }
  async function newConversation(){
    if(openingLock.current||sending.current)return;
    openingLock.current=true;setOpening(true);const ticket=view.current.next();stopVoice();
    try{const id=await create(ticket);await load(id,ticket);if(!view.current.current(ticket))return;setTemporary(false);setVolatile([]);setPending(null);setReceipts([]);setError("");setNotice("Retained conversation created.");requestAnimationFrame(()=>messageRef.current?.focus());}
    catch{if(view.current.current(ticket))setError("Conversation creation was not confirmed. Refresh history before retrying.");}
    finally{if(view.current.current(ticket)){openingLock.current=false;setOpening(false);}}
  }
  // Typed and reviewed-voice messages take the same path. Only when computer control is on and a
  // paired Mac is known; otherwise the ordinary conversation flow is unchanged.
  async function computerFirst(next: Pending): Promise<boolean> {
    const device = computer.thisDevice ?? (computer.activeDevices.length === 1 ? computer.activeDevices[0] : null);
    if (!computer.server?.settings.enabled || !device) return false;
    const source: "text" | "voice" = voiceUsed.current ? "voice" : "text";
    sending.current = true; setBusy(true); setError("");
    try {
      const r = await contentRequest<{ kind: "not_command" } | { kind: "clarification"; message: string } | { kind: "proposal"; command: ProposedCommand & { device_id: string } }>("/api/v1/computer/proposals", "POST", { request_id: next.request_id, device_id: device.id, text: next.text, source, temporary: next.temporary });
      if (r.kind === "not_command") return false;
      setText(""); voiceUsed.current = false;
      const item: ComputerItem = r.kind === "clarification" ? { id: next.request_id, text: next.text, source, kind: "note", message: r.message } : { id: next.request_id, text: next.text, source, kind: "plan", command: r.command, autoRun: device.id === computer.thisDevice?.id };
      setComputerItems((items) => [...items, item].slice(-10));
      setNotice(r.kind === "proposal" ? "Computer action proposed. Nothing has run yet." : "Computer command needs clarification. Nothing was run.");
      return true;
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Computer command check failed."} Nothing was sent to the assistant or the Mac.`);
      return true;
    } finally { sending.current = false; setBusy(false); }
  }
  async function send(retry?: Pending) {
    if (busy||sending.current||openingLock.current) return;
    stopVoice();
    const next: Pending = retry ?? { text: text.trim(), request_id: crypto.randomUUID(), conversation_id: selected, temporary, provider };
    if (!next.text||next.text.length>2000) return;
    if (!retry && await computerFirst(next)) return;
    voiceUsed.current = false;
    const ticket=view.current.next();sending.current=true;
    setBusy(true); setError(""); setReceipts([]); setNotice(`${retry?"Retrying the same request. ":""}${next.provider==="openai"?"Waiting for OpenAI":"Streaming mock demonstration"} — not yet confirmed complete.`); setPartial(""); setUsed([]);
    const controller=new AbortController();abort.current = controller; active.current = null; stopping.current = Promise.resolve();
    let answer = "", completed = false, failure = false;
    try {
      if (!next.temporary && !next.conversation_id) { next.conversation_id = await create(ticket);if(!view.current.current(ticket))return;setSelected(next.conversation_id); }
      if(!view.current.current(ticket))return;
      setPending(next); setText("");
      const body = next.temporary
        ? { mode: "temporary", provider: next.provider, request_id: next.request_id, text: next.text, history: volatile.slice(-3).map((v) => ({ user_text: v.user_text.slice(0, 1000), assistant_text: "" })) }
        : { mode: "retained", provider: next.provider, conversation_id: next.conversation_id, request_id: next.request_id, text: next.text };
      const response = await fetch("/api/v1/turns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal, cache: "no-store" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Text request failed."); }
      await readEvents(response, (event) => {
        if(!view.current.current(ticket))return;
        if (event.type === "start") active.current = event;
        if (event.type === "delta") { answer += event.text; setPartial(answer); }
        if (event.type === "memories") setUsed(event.memories);
        if(event.type === "receipt")setReceipts(current=>[...current,event.text]);
        if (event.type === "failure") { failure = true; throw new Error(event.message); }
        if (event.type === "done") {
          completed = true;
          setNotice(event.proposal_id ? "Response saved. A pending memory proposal is ready in Memory; it is not approved." : next.temporary ? (next.provider === "openai" ? "Temporary response complete. No application content was saved; provider retention is separate." : "Temporary response complete. Nothing was saved.") : "Response confirmed complete.");
        }
      });
      if (view.current.current(ticket) && completed && !failure) {
        if (next.temporary) setVolatile((previous) => [...previous, { user_text: next.text, assistant_text: answer, provider: next.provider }].slice(-30));
        setPending(null);
      }
    } catch (cause) {
      if(!view.current.current(ticket))return;
      setError(controller.signal.aborted ? (next.provider === "openai" ? "Stopped. A review proposal may already exist in Memory/Today; inspect it. Retry keeps the request ID. AI responses cannot approve memories or confirm reminders." : !next.temporary && /^\/remind(?: |$)/.test(next.text) ? "Stopped. A reminder review draft may already exist in Today; it cannot schedule without confirmation. Retry keeps the same request ID." : "Stopped. Partial text was discarded. Retry keeps the same request ID.") : cause instanceof Error ? cause.message : "Response interrupted; completion was not confirmed.");
      setNotice("No complete answer was confirmed in this view.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      if(view.current.current(ticket)){
      await stopping.current;
      if(view.current.current(ticket)){
      setPartial(""); setUsed([]); active.current = null;
      if (!next.temporary && next.conversation_id) await load(next.conversation_id,ticket).catch(() => {if(view.current.current(ticket))setError("Could not reload saved state. Sign in again or reload before retrying.");});
      if(view.current.current(ticket)){sending.current=false;setBusy(false);}
      }}
    }
  }
  async function stop() {
    const turn = active.current;
    stopping.current = turn ? contentRequest("/api/v1/turns/cancel", "POST", turn).catch(() => setError("Stop was requested, but storage confirmation is unknown. Reload; a running attempt expires after 45 seconds.")) : Promise.resolve();
    abort.current?.abort();
    await stopping.current;
  }
  async function remove() {
    stopVoice();
    if (!selected||sending.current||openingLock.current) return;
    openingLock.current=true;setOpening(true);const ticket=view.current.next();
    try {
      await contentRequest(`/api/v1/conversations/${selected}`, "DELETE", {});
      if(!view.current.current(ticket))return;
      setSelected(null); setMessages([]); setPending(null); setReceipts([]); await list(ticket);
      if(view.current.current(ticket))setNotice("Conversation removed. Independently approved memories remain; manage them in Memory.");
    } catch { if(view.current.current(ticket))setError("Deletion was not confirmed. Reload to check before retrying."); }finally{if(view.current.current(ticket)){openingLock.current=false;setOpening(false);}}
  }
  return <div className="conversation-workspace">
    <header><p className="eyebrow">LOCAL PERSONAL WORKSPACE</p><h1>Assistant</h1><p className="page-description">{provider === "openai" ? `OpenAI · ${liveModel}. Selected context and approved retrieved memories leave this device. AI text is not an action receipt.` : "Deterministic mock provider. No live model is used for this selection."}</p></header>
    <div className="field"><label htmlFor="conversation-provider">Conversation provider</label><select id="conversation-provider" disabled={!hydrated||busy||opening} value={provider} onChange={e=>{providerChosen.current=true;setProvider(e.target.value as "mock"|"openai");}}><option value="mock">Local deterministic mock</option>{liveAvailable&&<option value="openai">OpenAI · {liveModel}</option>}</select>{providerError&&<p className="help">{providerError}</p>}{liveState&&<p className="help">Live text: {availabilityLabel(liveState)}. <Link href="/settings#providers">Review providers and permissions</Link>.</p>}<p className="help">No automatic provider failover. {historyPolicy(retention)} Worker cleanup removes expired content; approved memories remain until you delete or correct them.</p></div>
    <details className="first-actions"><summary>Ideas for a first conversation</summary><p>Try the selected provider, propose a memory for separate review, or create a task in Today. These controls never send or save automatically.</p><div className="button-row"><button className="button secondary" disabled={!hydrated||busy||opening||!!text.trim()} onClick={()=>{setText("Hello. What can I do here?");messageRef.current?.focus();}}>Draft a first greeting</button><button className="button secondary" disabled={!hydrated||busy||opening||temporary||!!text.trim()} onClick={()=>{setText(provider==="mock"?"Remember this: ":"Please propose a memory to remember: ");messageRef.current?.focus();}}>Draft a memory request</button><Link className="button secondary" href="/today#tasks-heading">Create a task in Today</Link></div></details>
    <div className="conversation-grid"><aside aria-label="Conversation history" className="conversation-history">
      <div className="button-row"><button className="button secondary" disabled={!hydrated || busy || opening} onClick={()=>void newConversation()}>New conversation</button>
      <button className="button secondary" disabled={!hydrated || busy || opening} aria-pressed={temporary} onClick={() => { view.current.invalidate();stopVoice(); setTemporary(true); setSelected(null); setMessages([]); setVolatile([]); setPending(null); setReceipts([]); setError(""); setNotice("Temporary mode. Refreshing or closing ends this conversation."); requestAnimationFrame(()=>messageRef.current?.focus()); }}>Temporary conversation</button></div>
      {!historyLoaded?<p className="help">{error?'Conversation history unavailable.':'Loading conversation history…'}</p>:conversations.length === 0 ? <p className="help">No retained conversations yet.</p> : <ul className="history-list">{conversations.map((c) => <li key={c.id}><button disabled={!hydrated || busy || opening} aria-current={selected === c.id ? "true" : undefined} onClick={() => select(c.id)}>{c.title}<span>{formatTimestamp(c.created_at)}</span></button></li>)}</ul>}
    </aside><section className="transcript-workspace" aria-label="Text conversation">
      <div className="conversation-mode"><strong>{temporary ? "Temporary · memory, task and reminder saving disabled" : "Retained conversation"}</strong>{selected && <button className="button secondary" disabled={!hydrated || busy || opening} onClick={remove}>Delete conversation</button>}</div>
      <p className="help">{temporary ? (provider === "openai" ? "Temporary application content is not retained. OpenAI processing/retention is a separate boundary. Refreshing/closing ends it." : "Content stays in this page’s memory. Refreshing/closing loses it.") + " Start a retained conversation to propose a saved memory. Reminders require the retained Today form." : "Messages are stored locally. Deleting this conversation removes its messages/proposals; separately approved memories remain."}</p>
      <div className="transcript" role="region" aria-label="Transcript" tabIndex={0}>{(temporary ? volatile : messages).map((m, i) => <article className="text-turn" key={isSavedTurn(m) ? m.id : i}><p className="speaker">You</p><p className="message-text">{m.user_text}</p><p className="speaker">{isSavedTurn(m) ? (m.provider_version.startsWith("deterministic") ? "Mock assistant" : "AI response · not an action receipt") : m.provider === "openai" ? "AI response · not an action receipt" : "Mock assistant"}</p><p className="message-text">{isSavedTurn(m) && m.state !== "complete" ? m.state === "redacted" ? "Response removed after a memory correction/deletion." : `${m.state === "running" ? "Unconfirmed running/interrupted" : m.state} — no completed answer. Retry this request below.` : m.assistant_text}</p>{(!isSavedTurn(m)||m.state==="complete")&&m.assistant_text&&<ReadAloud text={m.assistant_text}/>} {isSavedTurn(m) && m.used_memories.length > 0 && <p className="help">Used approved memories ({m.used_memories.length}). <Link href="/memory">Inspect Memory</Link></p>}{isSavedTurn(m) && ["running", "failed", "cancelled"].includes(m.state) && <button className="button secondary" disabled={!hydrated || busy || opening} onClick={() => send({ text: m.user_text, request_id: m.request_id, conversation_id: m.conversation_id, temporary: false, provider: m.provider_version.startsWith("deterministic") ? "mock" : "openai" })}>Retry this turn</button>}</article>)}
      {pending && !messages.some((m) => m.request_id === pending.request_id) && <div className="text-turn"><p className="speaker">You · {temporary ? "temporary" : "sending / retryable"}</p><p className="message-text">{pending.text}</p></div>}
      {busy && <div className="text-turn"><p className="speaker">{(pending?.provider??provider) === "openai" ? "AI response · streaming preview, not an action receipt" : "Mock assistant · streaming, unconfirmed"}</p><p className="message-text">{partial || ((pending?.provider??provider)==="openai"?"Waiting for OpenAI…":"Preparing demonstration…")}</p>{used.length > 0 && <details><summary>Used approved memories</summary><ul>{used.map((m) => <li key={m.id}>{m.content}</li>)}</ul></details>}</div>}
      {computerItems.map((item) => <article className="text-turn" key={item.id}><p className="speaker">You · computer command{item.source === "voice" ? " (reviewed voice transcript)" : ""}</p><p className="message-text">{item.text}</p>{item.kind === "note" ? <><p className="speaker">Computer control · nothing was run</p><p className="message-text">{item.message}</p></> : <ComputerPlan command={item.command} bridge={computer.bridge.current} connected={!!computer.thisDevice && item.command.device_id === computer.thisDevice.id} autoRun={item.autoRun} onSettled={() => void computer.refresh()} />}</article>)}</div>
      {receipts.length>0&&<aside aria-label="Application operation receipts">{receipts.map((text,i)=><p key={i} className="notice">{text}</p>)}</aside>}
      <p className="help" role="status">{notice}</p>{error && <p className="error-message" role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
      <VoiceInput key={`${temporary?"temporary":"retained"}:${selected??"draft"}`} replyBusy={busy} onUse={value=>{voiceUsed.current=true;setText(current=>{const combined=(current?current+"\n":"")+value;if(combined.length>2000){setError("Message plus transcript exceeds 2,000 characters. Shorten it before sending.");}return combined;});requestAnimationFrame(()=>messageRef.current?.focus());}}/>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><label htmlFor="message">Message</label><textarea ref={messageRef} id="message" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={3} required disabled={!hydrated} aria-describedby="message-help" />
      <p id="message-help" className="help">{temporary ? "Memory, task and reminder actions are disabled in temporary mode. Use a retained conversation or Today to save information." : provider==="openai" ? "Explicitly ask to remember information, then review its exact proposal in Memory. Ask for a reminder with a date and time; review and confirm the resulting draft in Today. For daily/weekly schedules include a start date, local time and timezone. Snooze individual pending occurrences in Today." : "To propose a mock memory, start exactly with “Remember this: …”. Approve separately in Memory. Use /remind YYYY-MM-DDTHH:mm IANA/Zone | title for a review-only draft. For a mock series: “Remind me every weekday at 8 PM to study starting YYYY-MM-DD”. Missing start dates ask for clarification."} Tasks: “Add a task to finish my assignment”, “Make it due YYYY-MM-DD”, “Mark the assignment task complete”, “Remind me about it tomorrow at 7 PM”, or “Show my overdue tasks”. Chat changes require review in Today. Manual tasks/reminders remain available without AI.</p>
      {computer.server?.settings.enabled && <p className="help">Computer control is on{computer.thisDevice ? ` for ${computer.thisDevice.name}` : " (no connected paired Mac)"}. Commands such as “Open Safari”, “Set the volume to 30 percent” or “Run my study setup” are matched against items approved on the Mac, without an AI call, and are not saved in this conversation; see Settings → Computer for history.</p>}
      <div className="button-row"><button className="button primary" disabled={!hydrated || busy || opening || !text.trim() || text.length>2000}>Send message</button>{busy && <button type="button" className="button secondary" onClick={stop}>Stop response</button>}{!busy && pending && <button type="button" className="button secondary" onClick={() => send(pending)}>Retry last request</button>}</div></form>
    </section></div>
  </div>;
}
