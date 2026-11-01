'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Temporal} from '@js-temporal/polyfill';
import {useHydrated} from '@/lib/use-hydrated';
import {DST_POLICY,describeRecurrence,weekdays,type Recurrence,type ReminderSeries} from '@/lib/reminders/recurrence';
import type {Reminder} from '@/lib/reminders/types';
const fresh=(timezone:string):Recurrence=>({title:'',frequency:'daily',weekdays:[],start_date:'',end_date:null,local_time:'20:00',timezone,channel:'mock',dst_policy:DST_POLICY,late_minutes:5});
export function SeriesWorkspace({timezone,liveAvailable,onChanged,occurrences}:{timezone:string;liveAvailable:boolean;onChanged:()=>Promise<void>;occurrences:Reminder[]}){
 const hydrated=useHydrated();const [form,setForm]=useState(()=>fresh(timezone)),[editing,setEditing]=useState<ReminderSeries|null>(null),[review,setReview]=useState<ReminderSeries|null>(null);
 const [series,setSeries]=useState<ReminderSeries[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const locked=useRef(false);
 const focus=useRef<HTMLElement>(null),errorRef=useRef<HTMLParagraphElement>(null),key=useRef<{signature:string;id:string}|null>(null);
 const load=useCallback(async()=>{
  const response=await fetch('/api/v1/reminder-series',{cache:'no-store'});
  if(!response.ok)throw new Error('Series storage is unavailable. Retry after checking your session and the setup steps. No schedule was changed.');
  const s=await response.json();setSeries(s.series);setLoaded(true);
 },[]);
 useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
 useEffect(()=>{if(review)focus.current?.focus();},[review]);
 function change<K extends keyof Recurrence>(k:K,v:Recurrence[K]){setForm(f=>({...f,[k]:v}));setReview(null);setError('');}
 async function command(body:Record<string,unknown>){
  if(locked.current)return null;locked.current=true;
  setBusy(true);setError('');setStatus('');const signature=JSON.stringify(body);if(key.current?.signature!==signature)key.current={signature,id:crypto.randomUUID()};
  try{
   const response=await fetch('/api/v1/reminder-series',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,request_id:key.current.id})});
   const result=await response.json();if(!response.ok)throw new Error(result.error);
   await load();await onChanged();key.current=null;return result as {series:ReminderSeries;operation:{id:string};replay:boolean};
  }catch(e){setError(e instanceof Error?e.message:'Operation unavailable. Refresh before retrying; the result may already be saved.');requestAnimationFrame(()=>errorRef.current?.focus());return null;}finally{locked.current=false;setBusy(false);}
 }
 return <section className="settings-section" aria-labelledby="series-heading"><div><h2 id="series-heading">Recurring reminders</h2><p>A series keeps its chosen timezone. Each occurrence has its own delivery history. Daily and weekly only; monthly, yearly and arbitrary rules are not supported.</p></div><div className="stack">
 <form className="stack" onSubmit={async e=>{e.preventDefault();const result=await command({action:'review',schedule:form,...(editing?{id:editing.id,version:editing.version}:{})});if(result){setReview(result.series);setStatus('Review saved. No new or changed series schedule is confirmed yet.');}}}>
 <fieldset disabled={!hydrated||busy}><legend>{editing?'Edit future occurrences':'New recurring schedule'}</legend>
 <div className="field"><label htmlFor="series-title">Series title</label><input id="series-title" required maxLength={120} value={form.title} onChange={e=>change('title',e.target.value)}/></div>
 <div className="field"><label htmlFor="series-frequency">Repeat</label><select id="series-frequency" value={form.frequency} onChange={e=>{change('frequency',e.target.value as Recurrence['frequency']);change('weekdays',e.target.value==='daily'?[]:[1,2,3,4,5]);}}><option value="daily">Daily</option><option value="weekly">Weekly on selected weekdays</option></select></div>
 {form.frequency==='weekly'&&<fieldset><legend>Weekdays (at least one)</legend><div className="weekday-options">{weekdays.map((day,i)=><label key={day}><input type="checkbox" checked={form.weekdays.includes(i+1)} onChange={e=>change('weekdays',e.target.checked?[...form.weekdays,i+1]:form.weekdays.filter(d=>d!==i+1))}/>{day}</label>)}</div></fieldset>}
 <div className="field"><label htmlFor="series-start">Start date</label><input id="series-start" required type="date" value={form.start_date} onChange={e=>change('start_date',e.target.value)}/></div>
 <div className="field"><label htmlFor="series-end">Inclusive end date (optional)</label><input id="series-end" type="date" value={form.end_date??''} onChange={e=>change('end_date',e.target.value||null)}/><p className="help">Leave empty to repeat until cancelled. End dates include that local calendar day.</p></div>
 <div className="field"><label htmlFor="series-time">Recurring local time</label><input id="series-time" type="time" required value={form.local_time} onChange={e=>change('local_time',e.target.value)}/></div>
 <div className="field"><label htmlFor="series-zone">Fixed series timezone</label><input id="series-zone" required maxLength={100} value={form.timezone} onChange={e=>change('timezone',e.target.value)}/></div>
 <div className="field"><label htmlFor="series-channel">Series delivery channel</label><select id="series-channel" value={form.channel} onChange={e=>change('channel',e.target.value as Recurrence['channel'])}><option value="mock">Local mock — no phone notification</option>{(liveAvailable||form.channel==='pushover')&&<option value="pushover" disabled={!liveAvailable}>Pushover — generic notification</option>}</select></div>
 <div className="field"><label htmlFor="series-late">Lateness window in minutes</label><input id="series-late" type="number" min={1} max={60} required value={form.late_minutes} onChange={e=>change('late_minutes',Number(e.target.value))}/><p className="help">Default 5. Older unsent occurrences become Missed. A restart does not send a backlog.</p></div>
 <p className="help">Clock policy: nonexistent times shift forward by the clock change; repeated times use the earlier instant. The next ordinary occurrence returns to your selected wall-clock time.</p>
 <div className="button-row"><button className="button secondary" type="submit">Preview recurring schedule</button>{editing&&<button type="button" className="button secondary" onClick={()=>{setEditing(null);setReview(null);setForm(fresh(timezone));}}>Leave schedule edit</button>}</div>
 </fieldset></form>
 {review?.review&&<section className="reminder-review" aria-label="Exact recurring schedule review" tabIndex={-1} ref={focus}><h3>Confirm series: {review.review.schedule.title}</h3><p>{describeRecurrence(review.review.schedule)}</p><p>Channel: {review.review.schedule.channel==='mock'?'Local mock — no phone delivery':'Pushover — generic notification'}. Clock policy: {review.review.schedule.dst_policy}. Lateness: {review.review.schedule.late_minutes} minutes.</p><h4>Next three occurrences{review.review.preview.length<3?' (or those remaining before the end date)':''}</h4><ol>{review.review.preview.map(c=><li key={c.date}>{c.local_datetime.replace('T',' ')} · {review.review!.schedule.timezone} · UTC offset {c.offset}; UTC {c.due_at}. {c.adjustment==='none'?'No clock adjustment':c.adjustment==='fold_earlier'?'Repeated time: earlier occurrence':'Nonexistent time: shifted forward'}.</li>)}</ol><p>Schedule version {review.version}, review {review.review_version}. Confirming replaces future unsent work; history and in-flight outcomes are retained.</p><button className="button primary" disabled={!hydrated||busy||(review.review.schedule.channel==='pushover'&&!liveAvailable)} onClick={async()=>{const result=await command({action:'confirm',id:review.id,version:review.version,review_version:review.review_version,review:review.review});if(result){setReview(null);setEditing(null);setForm(fresh(timezone));setStatus(`${result.replay?"Existing confirmation operation":"Series confirmed; scheduling requested"}. Operation ${result.operation.id}. Current series state: ${result.series.state}. Inspect occurrence status below; no delivery is claimed.`);}}}>Confirm exact recurring schedule</button></section>}
 {error&&<p className="error-message" role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
 <p aria-live="polite">{status||(!loaded?(error?'Series unavailable.':'Loading series…'):'Series actions affect future occurrences. Use an occurrence’s snooze to change only that one.')}</p>
 <button className="button secondary" disabled={!hydrated||busy} onClick={()=>void load().then(onChanged).catch(e=>setError(e.message))}>Refresh series</button>
 {loaded&&!series.length&&<p>No recurring reminders yet.</p>}
 {series.map(s=>{const next=occurrences.filter(r=>r.series_id===s.id&&r.series_version===s.version&&['scheduling_pending','scheduled','retry_scheduled','attempt_started'].includes(r.state)).sort((a,b)=>a.due_at.localeCompare(b.due_at))[0];return <article className="reminder-row" key={s.id} aria-label={`Series: ${s.schedule.title}`}><h3>{s.schedule.title}</h3><p>{describeRecurrence(s.schedule)}</p><p><strong>{s.state==='paused'?'Paused — no new dispatch':s.state}</strong>. Next occurrence: {next?`${next.local_datetime} ${next.timezone}`:s.state==='active'?'Worker reconciliation pending':'None pending'}. {s.schedule.channel==='mock'?'Local mock':'Pushover generic channel'}.</p><div className="button-row">
 {s.review&&<button className="button secondary" disabled={!hydrated||busy} onClick={()=>setReview(s)}>Review proposed series</button>}
 {s.state!=='cancelled'&&<button className="button secondary" disabled={!hydrated||busy} onClick={()=>{setEditing(s);setReview(null);setForm({...s.schedule,start_date:Temporal.Now.zonedDateTimeISO(s.schedule.timezone).toPlainDate().toString()});setStatus('Editing future occurrences. Choose dates and preview; the current schedule remains active until confirmation.');}}>Edit future schedule</button>}
 {(['active','paused'].includes(s.state))&&<button className="button secondary" disabled={!hydrated||busy} onClick={async()=>{const action=s.state==='paused'?'resume':'pause';const r=await command({action,id:s.id,version:s.version});if(r)setStatus(`Current series state: ${r.series.state}. ${action==='pause'?'Pause invalidates unsent work; an in-flight send cannot be recalled.':'Resume chooses the next future local occurrence; paused dates are not replayed.'}`);}}>{s.state==='paused'?'Resume series':'Pause series'}</button>}
 {s.state==='active'&&next&&<button className="button secondary" disabled={!hydrated||busy} onClick={async()=>{if(await command({action:'skip',id:s.id,version:s.version,occurrence_id:next.id}))setStatus('Next occurrence skipped. The series calendar remains unchanged.');}}>Skip next occurrence</button>}
 {s.state!=='cancelled'&&<button className="button secondary" disabled={!hydrated||busy} onClick={async()=>{if(await command({action:'cancel',id:s.id,version:s.version}))setStatus('Series cancelled. History is retained; any already in-flight send cannot be recalled.');}}>Cancel entire series</button>}
 </div></article>;})}
 </div></section>;
}
