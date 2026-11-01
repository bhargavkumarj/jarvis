import Link from "next/link";
export default function NotFound() { return <main id="main" className="error-page"><h1>This page isn’t here.</h1><p>Return to your workspace to continue.</p><Link className="button primary" href="/assistant">Open workspace</Link></main>; }
