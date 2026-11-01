'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { TaskWorkspace } from './task-workspace';
import { SeriesWorkspace } from './series-workspace';
import { SnoozeControls } from './snooze-controls';
import { useHydrated } from '@/lib/use-hydrated';
import { reminderLabels,snapshot,type Reminder,type DeliveryAttempt,type OperationReceipt } from '@/lib/reminders/types';
import type { ScheduleInput } from '@/lib/reminders/time';
const terminal=['simulated_acceptance','provider_accepted','failed','outcome_unknown','cancelled','expired','missed','skipped'];
export function ReminderWorkspace({timezone}:{timezone:string}){
 const hydrated=useHydrated();
 const [liveAvailable,setLiveAvailable]=useState(false),[channel,setChannel]=useState<'mock'|'pushover'>('mock');
 const [channelError,setChannelError]=useState('');
 useEffect(()=>{let mounted=true;void fetch('/api/v1/integrations',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(v=>{if(mounted)setLiveAvailable(v.pushover_available===true);}).catch(()=>{if(mounted)setChannelError('Live channel availability could not be checked. Reload when local services are available; no channel has been switched.');});return()=>{mounted=false;};},[]);
 const [form,setForm]=useState<ScheduleInput>({title:'',local_datetime:'',timezone});
 const [draft,setDraft]=useState<Reminder|null>(null),[reviewed,setReviewed]=useState(false);
 const [rows,setRows]=useState<Reminder[]>([]),[detail,setDetail]=useState<{reminder:Reminder;attempts:DeliveryAttempt[]}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[loaded,setLoaded]=useState(false);
 const errorRef=useRef<HTMLDivElement>(null),pending=useRef<{signature:string;id:string}|null>(null);
 const reviewRef=useRef<HTMLElement>(null),locked=useRef(false);
 useEffect(()=>{if(reviewed&&draft)reviewRef.current?.focus();},[reviewed,draft]);
 const load=useCallback(async()=>{
  const response=await fetch('/api/v1/reminders',{cache:'no-store'});const data=await response.json();
  if(!response.ok)throw new Error(data.error);setRows(data.reminders);setLoaded(true);
 },[]);
 useEffect(()=>{void load().catch(()=>setError('Reminders could not be loaded. Sign in again if your session ended, then retry.'));},[load]);
 const change=(key:keyof ScheduleInput,value:string)=>{setForm({...form,[key]:value});setReviewed(false);setError('');};
 async function command(body:Record<string,unknown>){
  if(locked.current)return null;locked.current=true;
  setBusy(true);setError('');setStatus('');
  const signature=JSON.stringify(body);
  if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
  try{
   const response=await fetch('/api/v1/reminders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,request_id:pending.current.id})});
   const data=await response.json();if(!response.ok)throw new Error(data.error);
   await load();pending.current=null;return data as OperationReceipt;
  }catch(cause){setError(cause instanceof TypeError?'Could not confirm the result. Retry the same operation or refresh to inspect saved state.':cause instanceof Error?cause.message:'Operation unavailable.');requestAnimationFrame(()=>errorRef.current?.focus());return null;}
  finally{locked.current=false;setBusy(false);}
 }
 async function inspect(id:string){
  try{const response=await fetch(`/api/v1/reminders?id=${id}`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error);setDetail(data);}
  catch{setError('Reminder details unavailable. Refresh or sign in again.');}
 }
 function schedule(r:Reminder){return <dl className="reminder-schedule"><div><dt>Full local date and time</dt><dd>{r.local_datetime.replace('T',' · ')} ({r.timezone})</dd></div><div><dt>Resolved UTC instant</dt><dd>{new Date(r.due_at).toISOString()}</dd></div><div><dt>Clock-change resolution</dt><dd>{r.resolution}</dd></div><div><dt>Channel</dt><dd>{r.channel==='pushover'?'Pushover — generic Android notification':'Local mock — no phone notification'}</dd></div></dl>;}
 return <div className="content-workspace"><header className="page-header"><p className="eyebrow">TODAY</p><h1>Today</h1><p>Tasks, deadlines, and separate one-time or recurring reminders. Mock and Pushover channels are explicitly separate. Supabase, Docker and the separate worker must remain running; the website may be closed.</p></header>
 <TaskWorkspace timezone={timezone} liveAvailable={liveAvailable} onChanged={load}/>
 <section className="settings-section" aria-labelledby="create-reminder"><div><h2 id="create-reminder">Create a reminder</h2><p>Review the exact time before confirming. Saving creates persistent account data. Choose a time five seconds to 365 days ahead.</p></div>
 <form className="stack" onSubmit={async e=>{e.preventDefault();const receipt=await command({action:'review',schedule:form,channel,...(draft?{draft_id:draft.id,version:draft.version}:{})});if(receipt){const isDraft=receipt.reminder.state==='draft';setDraft(isDraft?receipt.reminder:null);setReviewed(isDraft);setStatus(isDraft?'Draft reviewed. It is not saved for scheduling until you confirm the exact values.':`Existing review operation found. Recorded state: ${reminderLabels[receipt.reminder.state]}. No new reminder was created; inspect the list.`);}}}>
 <fieldset disabled={!hydrated||busy}><legend className="sr-only">One-time reminder schedule</legend><div className="field"><label htmlFor="reminder-title">Reminder title</label><input id="reminder-title" value={form.title} maxLength={120} required onChange={e=>change('title',e.target.value)}/></div>
 <div className="field"><label htmlFor="reminder-time">Local date and time</label><input id="reminder-time" type="datetime-local" step="1" required value={form.local_datetime} onChange={e=>change('local_datetime',e.target.value)} aria-describedby="schedule-help"/><p id="schedule-help" className="help">Full calendar date, hours, minutes and optional seconds. Your explicit timezone below controls this time.</p></div>
 <div className="field"><label htmlFor="reminder-zone">Reminder timezone</label><input id="reminder-zone" required value={form.timezone} maxLength={100} onChange={e=>change('timezone',e.target.value)}/></div>
 <div className="field"><label htmlFor="clock-choice">If this time occurs twice</label><select id="clock-choice" value={form.disambiguation??''} onChange={e=>{setForm({...form,disambiguation:e.target.value?e.target.value as 'earlier'|'later':undefined});setReviewed(false);}}><option value="">Ask me to choose</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select><p className="help">A nonexistent time is rejected; choose a valid time rather than applying a guessed shift.</p></div>
 <div className="field"><label htmlFor="reminder-channel">Delivery channel</label><select id="reminder-channel" value={channel} onChange={e=>{setChannel(e.target.value as 'mock'|'pushover');setReviewed(false);}}><option value="mock">Local mock — no phone notification</option>{(liveAvailable||channel==='pushover')&&<option value="pushover" disabled={!liveAvailable}>Pushover — {liveAvailable?'generic Android notification':'availability not confirmed'}</option>}</select>{channelError&&<p className="help">{channelError}</p>}<p className="help">Existing mock reminders never switch to your phone. Live delivery requires this explicit selection and a new confirmation.</p></div>
 <button className="button secondary" type="submit">{busy?'Working…':'Review exact schedule'}</button></fieldset></form></section>
 {draft&&reviewed&&<section ref={reviewRef} tabIndex={-1} className="reminder-review" aria-label="Exact reminder review"><h2>Confirm “{draft.title}”</h2>{schedule(draft)}<p>Version {draft.version}. Confirming saves this one-time reminder and requests scheduling. It does not mean delivery occurred.</p><button className="button primary" disabled={!hydrated||busy||(draft.channel==='pushover'&&!liveAvailable)} onClick={async()=>{const receipt=await command({action:'confirm',id:draft.id,version:draft.version,snapshot:snapshot(draft)});if(receipt){setStatus(`${reminderLabels[receipt.reminder.state]}. Operation ${receipt.operation.id}. This is the state recorded with the receipt; refresh for worker updates.`);setDraft(null);setReviewed(false);setForm({...form,title:'',local_datetime:''});}}}>Confirm exact reminder</button>{draft.channel==='pushover'&&!liveAvailable&&<p className="help">Confirm Pushover availability before continuing. Reload after repairing local channel setup; this draft remains live-channel only.</p>}</section>}
 {error&&<div ref={errorRef} className="error-message" role="alert" tabIndex={-1}>{error} <Link href="/sign-in">Sign in</Link></div>}
 <p role="status" aria-live="polite">{status||(!loaded?(error?'Reminder state is unavailable. No new operation was confirmed.':'Loading reminders…'):'Only confirmed reminders are scheduled. Refresh to see the worker’s latest result.')}</p>
 <SeriesWorkspace timezone={timezone} liveAvailable={liveAvailable} onChanged={load} occurrences={rows}/>
 <section aria-labelledby="reminders-title"><div className="save-row"><h2 id="reminders-title">Your reminders</h2><button className="button secondary" disabled={!hydrated||busy} onClick={()=>void load().then(()=>{if(detail)void inspect(detail.reminder.id);}).catch(()=>setError('Could not refresh reminders.'))}>Refresh reminders</button></div>
 {loaded&&!rows.some(r=>!r.task_id)&&<p>No reminders yet. Review your first one above.</p>}
 {rows.filter(r=>!r.task_id).map(r=><article key={r.id} className="reminder-row" aria-label={`Reminder: ${r.title}`}><h3>{r.title}</h3>{r.series_id&&<p>Series occurrence · nominal date {r.occurrence_date}. Clock adjustment: {r.dst_adjustment?.replaceAll("_"," ")}. Series controls above affect future work.</p>}<p><strong>{reminderLabels[r.state]}</strong>{r.cancel_requested_at&&r.state==='attempt_started'?' · Cancellation requested; an in-flight attempt cannot be recalled.':''}</p>{schedule(r)}
 <div className="button-row"><button className="button secondary" disabled={!hydrated||busy} onClick={()=>void inspect(r.id)}>Inspect attempts</button>
 {r.state==='draft'&&<button className="button secondary" disabled={!hydrated||busy} onClick={()=>{setDraft(r);setChannel(r.channel);setReviewed(true);setForm({title:r.title,local_datetime:r.local_datetime,timezone:r.timezone,...(r.resolution==='unique'?{}:{disambiguation:r.resolution})});setStatus('Exact persisted draft loaded for review.');}}>Review draft</button>}
 {!r.series_id&&!terminal.includes(r.state)&&!r.cancel_requested_at&&<button className="button secondary" disabled={!hydrated||busy} onClick={async()=>{const receipt=await command({action:'cancel',id:r.id,version:r.version});if(receipt){setStatus(receipt.operation.result.in_flight?'Cancellation requested. Sending already started and cannot be recalled.':'Cancelled. Unsent work will be denied.');if(draft?.id===r.id){setDraft(null);setReviewed(false);}if(detail?.reminder.id===r.id)void inspect(r.id);}}}>Cancel reminder</button>}</div><SnoozeControls reminder={r} onChanged={load}/></article>)}
 {rows.length===100&&<p>Showing the most recent 100 reminders. Older records remain in your account.</p>}</section>
 {detail&&<section className="reminder-review" aria-label="Reminder attempt history"><h2>Attempts for {detail.reminder.title}</h2><p>{reminderLabels[detail.reminder.state]}. {detail.reminder.error_code?.replaceAll('_',' ')}</p>{!detail.attempts.length?<p>No dispatch attempt recorded.</p>:<ol>{detail.attempts.map(a=><li key={a.id}>Attempt {a.ordinal}: {a.state==='simulated_acceptance'?'Simulated acceptance':a.state==='provider_accepted'?'Provider accepted':a.state.replaceAll('_',' ')}. Started {a.started_at}; {a.finished_at?`finished ${a.finished_at}`:'not finished'}.{a.error_code?` Reason: ${a.error_code.replaceAll('_',' ')}.`:''}
 {a.observation_recorded_at&&<p>User observation: {a.phone_observed?'Arrived around '+a.phone_observed_at:'Not observed yet'}. Recorded separately from provider acceptance.</p>}
 {detail.reminder.channel==='pushover'&&['provider_accepted','outcome_unknown'].includes(a.state)&&<div className="button-row">{[true,false].map(observed=><button key={String(observed)} className="button secondary" disabled={!hydrated||busy} onClick={async()=>{try{const response=await fetch('/api/v1/reminders/observe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attempt_id:a.id,observed,at:new Date().toISOString()})});if(!response.ok)throw new Error();await inspect(detail.reminder.id);setStatus('Your phone observation was recorded separately.');}catch{setError('Could not record the observation.');}}}>{observed?'Phone arrived around now':'Phone not observed yet'}</button>)}</div>}</li>)}</ol>}<p>Provider acceptance means queued by Pushover; phone arrival is a separate user observation. Simulated acceptance is a local mock receipt, not device delivery. An unknown outcome is not automatically resent. Cancellation cannot recall an already in-flight attempt.</p></section>}
 </div>;
}
