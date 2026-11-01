"use client";
import {notifyPrivacyChange} from "@/lib/privacy/client";
import { useEffect, useRef, useState } from "react";
import type { Memory, Proposal } from "@/lib/conversation/types";
import { contentRequest } from "@/lib/conversation/client";
import {formatTimestamp} from '@/lib/workspace';
type Action = { action: "edit_proposal" | "approve" | "reject" | "edit_memory" | "delete_memory"; id: string; version: number; content?: string; replace_id?: string; replace_version?: number; reviewed?: boolean };
type Source = { user_text: string; created_at: string };
function SourceDetail({ id }: { id: string | null }) {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState("");
  if (!id) return <p className="help">Source message unavailable: it may be deleted, expired or not retained. This independently approved memory remains.</p>;
  return <div><button className="button secondary" onClick={async () => { try { const data = await contentRequest<{ source: Source }>(`/api/v1/messages/${id}`); setSource(data.source); setError(""); } catch { setError("Source is no longer available."); } }}>Inspect source message</button>{source && <blockquote className="message-text">{source.user_text}<footer>{formatTimestamp(source.created_at)}</footer></blockquote>}{error && <p className="help">{error}</p>}</div>;
}
function ProposalReview({ proposal: p, memories, busy, act }: { proposal: Proposal; memories: Memory[]; busy: boolean; act: (v: Action) => Promise<void> }) {
  const [content, setContent] = useState(p.content);
  const [reviewed,setReviewed]=useState(false);
  const [replace, setReplace] = useState(false);
  const conflict = memories.find((m) => p.origin === "openai" ? m.id === p.conflict_memory_id : m.memory_key === content.split(":")[0].trim().toLowerCase());
  return <article className="memory-entry" aria-label="Pending memory proposal"><h3>Review exact proposed content</h3><p className="help">Pending · version {p.version} · {formatTimestamp(p.created_at)}. It is excluded from retrieval.</p>
    <p className="help">{p.origin==='openai'?'OpenAI proposal — awaiting your decision.':'Mock proposal — demonstration behavior.'}</p>
    <label htmlFor={`proposal-${p.id}`}>Proposed memory content</label><textarea id={`proposal-${p.id}`} value={content} onChange={(e) => { setContent(e.target.value); setReplace(false); setReviewed(false); }} maxLength={1000} rows={3} disabled={busy} />
    <SourceDetail id={p.source_message_id} />
    {conflict && <div className="notice"><p>Conflicting approved memory (version {conflict.version}):</p><p className="message-text">{conflict.content}</p><label className="check-label"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={busy} />Replace this approved memory with the exact proposal above. Old retrieved responses will be removed.</label></div>}
    {p.origin==="openai"&&<label className="check-label"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/>I reviewed this exact content and the approved memories below for conflicts.</label>}
    <div className="button-row"><button className="button secondary" disabled={busy || !content.trim() || content === p.content} onClick={() => act({ action: "edit_proposal", id: p.id, version: p.version, content })}>Save proposal edit</button>
    <button className="button primary" disabled={busy || content !== p.content || !content.trim() || (!!conflict && !replace) || (p.origin === "openai" && !reviewed)} onClick={() => act({ action: "approve", id: p.id, version: p.version, content, reviewed, ...(conflict ? { replace_id: conflict.id, replace_version: conflict.version } : {}) })}>Approve exact memory</button>
    <button className="button secondary" disabled={busy} onClick={() => act({ action: "reject", id: p.id, version: p.version })}>Reject proposal</button></div>
    {content !== p.content && <p className="help">Save the edit first, then review and approve the new version.</p>}
  </article>;
}
function ApprovedMemory({ memory: m, busy, act }: { memory: Memory; busy: boolean; act: (v: Action) => Promise<void> }) {
  const [content, setContent] = useState(m.content);
  const [deleting, setDeleting] = useState(false);
  return <article className="memory-entry" aria-label="Approved memory"><h3>Approved memory · version {m.version}</h3><p className="help">Approved {formatTimestamp(m.approved_at)} · source {formatTimestamp(m.source_date)}{m.source_kind === "user_correction" ? ` · corrected by you ${formatTimestamp(m.updated_at)}` : ""}</p>
    <label htmlFor={`memory-${m.id}`}>Approved memory content</label><textarea id={`memory-${m.id}`} value={content} onChange={(e) => setContent(e.target.value)} maxLength={1000} rows={3} disabled={busy} />
    <SourceDetail id={m.source_message_id} />
    <div className="button-row"><button className="button primary" disabled={busy || !content.trim() || content === m.content} onClick={() => act({ action: "edit_memory", id: m.id, version: m.version, content })}>Save approved correction</button><button className="button secondary" disabled={busy} onClick={() => setDeleting(!deleting)}>Delete memory</button></div>
    {deleting && <div className="notice"><p>Remove this memory from retrieval and clear its saved/proposal payload and derived replies. Source user messages remain until you delete their conversation.</p><button className="button secondary" disabled={busy} onClick={() => act({ action: "delete_memory", id: m.id, version: m.version })}>Confirm memory deletion</button></div>}
  </article>;
}
export function MemoryWorkspace() {
  const [proposals, setProposals] = useState<Proposal[]>([]), [memories, setMemories] = useState<Memory[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("Loading memory…");
  const [loaded,setLoaded]=useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  async function reload() {
    const data = await contentRequest<{ proposals: Proposal[]; memories: Memory[] }>("/api/v1/memories");
    setProposals(data.proposals); setMemories(data.memories); setLoaded(true);
  }
  useEffect(() => {
    let mounted = true;
    contentRequest<{ proposals: Proposal[]; memories: Memory[] }>("/api/v1/memories").then((data) => { if (mounted) { setProposals(data.proposals); setMemories(data.memories); setLoaded(true); setStatus(""); } }).catch(() => { if (mounted) { setError("Memory storage unavailable. Your saved records could not be checked. Sign in again if your session ended, or retry when services are available."); setStatus(""); } });
    return () => { mounted = false; };
  }, []);
  async function act(value: Action) {
    setBusy(true); setError("");
    try {
      await contentRequest("/api/v1/memories", "POST", value);
      await reload();
      if(value.action==="delete_memory"||value.action==="edit_memory"||value.action==="reject")notifyPrivacyChange();
      setStatus(value.action === "approve" ? "Memory approved and active." : value.action === "reject" ? "Proposal rejected; its content was removed." : value.action === "delete_memory" ? "Memory deleted and excluded from retrieval. Source user messages may remain." : "Change saved. Review the current version.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Change was not confirmed. Reload and review again.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setBusy(false); }
  }
  return <div className="memory-workspace"><p className="eyebrow">YOUR EXPLICIT CHOICES</p><h1>Memory</h1><p className="page-description">Only active, approved memories are retrieved. Retrieval uses bounded lexical matching. Live proposals still require your exact separate approval; semantic conflicts can be missed. No automatic extraction runs.</p>
    <p className="help" role="status">{status}</p>{error && <p className="error-message" role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
    {error&&<button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await reload();setError("");setStatus("Memory refreshed.");}catch{setError("Memory is still unavailable. Existing data has not been declared empty or deleted.");}finally{setBusy(false);}}}>Retry memory loading</button>}
    <section aria-labelledby="pending-title"><h2 id="pending-title">Pending review</h2>{!loaded?<p className="description">{error?'Pending proposals unavailable.':'Loading pending proposals…'}</p>:proposals.length === 0 ? <p className="description">No pending proposals. Explicitly ask to remember information in a retained conversation. The mock uses “Remember this: …”.</p> : proposals.map((p) => <ProposalReview key={`${p.id}-${p.version}`} proposal={p} memories={memories} busy={busy} act={act} />)}</section>
    <section aria-labelledby="approved-title"><h2 id="approved-title">Approved memories</h2>{!loaded?<p className="description">{error?'Approved memories unavailable.':'Loading approved memories…'}</p>:memories.length === 0 ? <p className="description">No approved memories yet. Nothing is retrieved until you approve it.</p> : memories.map((m) => <ApprovedMemory key={`${m.id}-${m.version}`} memory={m} busy={busy} act={act} />)}</section>
    <p className="help">Deletion clears saved payloads, pending copies and derived saved replies, leaving content-free lifecycle tombstones. Retained source user messages are separate. Deleting a conversation removes its proposals/source links; independently approved memories remain. No summaries, embeddings or extraction jobs exist in this slice. Previously delivered content cannot be recalled from another open view.</p>
  </div>;
}
