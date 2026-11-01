import { Temporal } from "@js-temporal/polyfill";
export type Resolution = "unique" | "earlier" | "later";
export type ScheduleInput = { title: string; local_datetime: string; timezone: string; disambiguation?: "earlier" | "later" };
export type ResolvedSchedule = { title: string; local_datetime: string; timezone: string; due_at: string; resolution: Resolution; channel: "mock" | "pushover" };
export class ScheduleError extends Error {
  kind: "invalid" | "gap" | "ambiguous" | "range";
  candidates: string[];
  constructor(kind: ScheduleError["kind"], message: string, candidates: string[] = []) { super(message); this.kind = kind; this.candidates = candidates; }
}
export function resolveSchedule(input: ScheduleInput, now = Date.now()): ResolvedSchedule {
  const title = input.title.trim(), timezone = input.timezone.trim();
  if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)) throw new ScheduleError("invalid", "Use a title of 1–120 ordinary characters."); // eslint-disable-line no-control-regex
  if (timezone.length > 100 || (timezone !== "UTC" && (!timezone.includes("/") || /^(posix|right)\//.test(timezone)))) throw new ScheduleError("invalid", "Use an explicit IANA timezone, such as Asia/Kolkata or UTC.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(input.local_datetime)) throw new ScheduleError("invalid", "Use a full calendar date and local time, without Z or an offset.");
  const local_datetime = input.local_datetime.length === 16 ? input.local_datetime + ":00" : input.local_datetime;
  let local: Temporal.PlainDateTime, earlier: Temporal.ZonedDateTime, later: Temporal.ZonedDateTime;
  try {
    local = Temporal.PlainDateTime.from(local_datetime, { overflow: "reject" });
    if (local.toString({ smallestUnit: "second" }) !== local_datetime) throw new Error("Unsupported date/time");
    earlier = local.toZonedDateTime(timezone, { disambiguation: "earlier" });
    later = local.toZonedDateTime(timezone, { disambiguation: "later" });
  } catch { throw new ScheduleError("invalid", "Check the calendar date, time and IANA timezone."); }
  const options = [earlier, later].filter((z) => z.toPlainDateTime().equals(local));
  const unique = [...new Map(options.map((z) => [z.epochMilliseconds, z])).values()];
  if (!unique.length) throw new ScheduleError("gap", "This local time does not exist because the clock changes. Choose a different valid date/time; no shift was guessed.");
  if (unique.length > 1 && !input.disambiguation) throw new ScheduleError("ambiguous", "This local time occurs twice. Explicitly choose the earlier or later occurrence, then review again.", unique.map((z) => z.toInstant().toString()));
  const selected = unique.length === 1 ? unique[0] : input.disambiguation === "earlier" ? earlier : later;
  if (selected.epochMilliseconds < now + 5000 || selected.epochMilliseconds > now + 365 * 86400_000) throw new ScheduleError("range", "Choose a time at least five seconds ahead and within 365 days.");
  return { title, local_datetime, timezone: selected.timeZoneId, due_at: selected.toInstant().toString(), resolution: unique.length === 1 ? "unique" : input.disambiguation!, channel: "mock" };
}
// Explicit fixture grammar only. It never interprets arbitrary dates or saves.
export function parseReminderCommand(text: string): ScheduleInput | null {
  const match = text.match(/^\/remind (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?) (\S+)(?: (earlier|later))? \| (.{1,120})$/);
  return match ? { local_datetime: match[1], timezone: match[2], disambiguation: match[3] as "earlier" | "later" | undefined, title: match[4] } : null;
}
