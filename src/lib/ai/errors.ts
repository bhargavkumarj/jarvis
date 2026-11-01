// Only these fixed messages may cross the live-provider error boundary.
const messages = {
 allowance: 'AI allowance or concurrency limit reached. Manual reminders remain available.',
 disabled: 'Live AI is not enabled for this account. No fallback provider was used.',
 accounting: 'AI usage accounting is unavailable. Uncertain charges remain reserved; no automatic retry was made.',
 context: 'Approved memory changed before dispatch. Reload and try again.',
 credentials: 'OpenAI rejected access. Review the private project key and model permissions locally.',
 rate_limit: 'OpenAI is rate limiting requests. Wait before trying again; no automatic retry was made.',
 timeout: 'OpenAI timed out. The outcome and charge may be uncertain; no automatic retry was made.',
 incomplete: 'OpenAI did not finish a complete response. Partial output was discarded.',
 invalid: 'The AI response did not meet the application’s output or proposal rules. No model action was approved.',
 unavailable: 'The live response could not be completed. Check provider availability and local services.',
};
export class LiveAIError extends Error {
 constructor(readonly kind:keyof typeof messages){super(messages[kind]);}
}
export function liveFailureMessage(error:unknown){
 const reason=error instanceof LiveAIError?error.message:messages.unavailable;
 return reason+' Review proposals may already exist in Memory/Today; inspect before retrying. AI responses cannot approve memories or confirm reminders. No fallback provider was used.';
}
