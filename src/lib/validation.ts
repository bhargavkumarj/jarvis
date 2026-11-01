import { z } from "zod";

const plainName = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`)
  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in user-visible names.
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Use ordinary text without control characters.");
export const preferencesSchema = z.strictObject({
  display_name: plainName(60),
  assistant_name: plainName(40).refine((s) => s.length > 0, "Enter an assistant name."),
  tone: z.enum(["balanced", "concise", "warm"], { error: "Choose a listed tone." }),
  timezone: z.string().max(100).refine((value) => {
    if (value !== "UTC" && (!value.includes("/") || /^(posix|right)\//.test(value))) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Use an IANA timezone such as Asia/Kolkata or UTC."),
  locale: z.enum(["en-IN", "en-GB", "en-US"], { error: "Choose a supported English locale." }),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const emailSchema = z.email("Enter a valid email address.").max(254).transform((s) => s.toLowerCase());
export const newPassword = z.string().min(12, "Use at least 12 characters.").max(128, "Use at most 128 characters.");
export const credentialsSchema = z.strictObject({ email: emailSchema, password: z.string().min(1).max(128) });
export const registrationSchema = z.strictObject({ email: emailSchema, password: newPassword });
export const verificationSchema = z.strictObject({
  email: emailSchema, token: z.string().regex(/^\d{6}$/, "Enter the six-digit email code."),
  type: z.enum(["email", "recovery"]),
});
