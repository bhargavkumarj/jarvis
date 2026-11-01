"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main id="main" className="error-page"><p className="eyebrow">LET’S TRY THAT AGAIN</p><h1>The workspace is unavailable.</h1><p>Check that local Supabase is running and your configuration is complete. Your changes have not been confirmed saved.</p><button className="button primary" onClick={reset}>Try again</button><a href="/sign-in">Return to sign in</a></main>;
}
