import { z } from "zod";
export const scheduleSchema = z.strictObject({ title: z.string().min(1).max(120), local_datetime: z.string().max(19), timezone: z.string().min(1).max(100), disambiguation: z.enum(["earlier", "later"]).optional() });
export const reviewSchema = z.strictObject({ request_id: z.uuid(), schedule: scheduleSchema, draft_id: z.uuid().optional(), version: z.number().int().positive().optional(), channel: z.enum(["mock", "pushover"]).default("mock") });
export const snapshotSchema = z.strictObject({ title: z.string().min(1).max(120), local_datetime: z.string().max(19), timezone: z.string().max(100), due_at: z.iso.datetime(), resolution: z.enum(["unique", "earlier", "later"]), channel: z.enum(["mock", "pushover"]), version: z.number().int().positive() });
export const confirmSchema = z.strictObject({ request_id: z.uuid(), id: z.uuid(), version: z.number().int().positive(), snapshot: snapshotSchema });
export const cancelReminderSchema = z.strictObject({ request_id: z.uuid(), id: z.uuid(), version: z.number().int().positive() });
