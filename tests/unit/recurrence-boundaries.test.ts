// HTTP/RPC mocks prove request gating only; real grants/atomicity live in the deferred integration suite.
import {beforeEach,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({account:vi.fn(),rpc:vi.fn(),from:vi.fn(),result:[] as unknown,owner:'00000000-0000-4000-8000-000000000001'}));
vi.mock('server-only',()=>({}));
vi.mock('../../src/lib/conversation/api',async()=>{
 const actual=await vi.importActual<typeof import('../../src/lib/conversation/api')>('../../src/lib/conversation/api');
 return {...actual,accountFor:h.account};
});
import {POST,GET} from '../../src/app/api/v1/reminder-series/route';
import {POST as snooze} from '../../src/app/api/v1/reminders/snooze/route';
import {DST_POLICY} from '../../src/lib/reminders/recurrence';
const id='00000000-0000-4000-8000-000000000002',request_id='00000000-0000-4000-8000-000000000003';
function request(body:unknown,path='reminder-series'){return new Request(`http://127.0.0.1:3000/api/v1/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:3000'},body:JSON.stringify(body)});}
const schedule={title:'Synthetic',frequency:'daily',weekdays:[],start_date:'2026-11-01',end_date:null,local_time:'20:00',timezone:'UTC',channel:'mock',dst_policy:DST_POLICY,late_minutes:5};
beforeEach(()=>{
 vi.useRealTimers();vi.clearAllMocks();h.result=[];
 h.account.mockResolvedValue({profile:{owner_id:h.owner},client:{rpc:h.rpc,from:h.from}});
 h.rpc.mockResolvedValue({data:{series:{id},operation:{id:request_id}},error:null});
 const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),not:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data:h.result,error:null})),limit:vi.fn(async()=>({data:h.result,error:null}))};h.from.mockReturnValue(chain);
});
it('series reads explicitly scope the verified owner and take no supplied owner identifiers',async()=>{const r=await GET(new Request('http://127.0.0.1:3000/api/v1/reminder-series'));expect(r.status).toBe(200);expect(h.from().eq).toHaveBeenCalledWith('owner_id',h.owner);expect((await GET(new Request('http://127.0.0.1:3000/api/v1/reminder-series?owner_id=forged'))).status).toBe(422);});
it('series endpoints reject owner injection and unsupported schedules before an RPC',async()=>{expect((await POST(request({action:'review',request_id,schedule,owner_id:id}))).status).toBe(422);expect((await POST(request({action:'review',request_id,schedule:{...schedule,frequency:'monthly'}}))).status).toBe(422);expect(h.rpc).not.toHaveBeenCalled();});
it('review uses the current user client and three exact Temporal candidates, with no confirmation authority',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));const req=request({action:'review',request_id,schedule});expect((await POST(req)).status).toBe(200);
 expect(h.account).toHaveBeenCalledWith(req,true);expect(h.rpc).toHaveBeenCalledOnce();expect(h.rpc).toHaveBeenCalledWith('reminder_series_v1',expect.objectContaining({p_action:'review',p_request:request_id,p_data:expect.objectContaining({schedule,preview:expect.arrayContaining([expect.objectContaining({due_at:'2026-11-01T20:00:00Z'})])})}));
 expect(h.rpc.mock.calls[0][1].p_data.preview).toHaveLength(3);vi.useRealTimers();
});
it('stale confirmation is a conflict with no success response',async()=>{h.rpc.mockResolvedValue({data:null,error:{code:'40001'}});const r=await POST(request({action:'confirm',id,version:2,review_version:4,request_id,review:{schedule,preview:[]}}));expect(r.status).toBe(409);expect(await r.json()).toEqual({error:expect.stringContaining('schedule changed')});});
it('confirmation forwards the exact reviewed version/content and no invented owner',async()=>{const review={schedule,preview:[]};const req=request({action:'confirm',id,version:2,review_version:4,request_id,review});await POST(req);expect(h.rpc).toHaveBeenCalledWith('reminder_series_v1',{p_action:'confirm',p_request:request_id,p_data:{id,version:2,review_version:4,review}});});
it('unavailable snooze identifier cannot call a mutation capability',async()=>{h.result=null;expect((await snooze(request({action:'review',id,minutes:10},'reminders/snooze'))).status).toBe(404);expect(h.from().eq).toHaveBeenCalledWith('owner_id',h.owner);expect(h.rpc).not.toHaveBeenCalled();});
it('snooze cannot accept a supplied timezone, channel, owner or worker outcome',async()=>{for(const fields of [{owner_id:id},{timezone:'Europe/London'},{channel:'pushover'},{outcome:'provider_accepted'}])expect((await snooze(request({action:'review',id,minutes:10,...fields},'reminders/snooze'))).status).toBe(422);expect(h.rpc).not.toHaveBeenCalled();});
it('terminal reminder review cannot resurrect an unknown outcome',async()=>{h.result={id,title:'Synthetic',state:'outcome_unknown',timezone:'UTC',due_at:'2026-11-01T20:00:00Z'};expect((await snooze(request({action:'review',id,minutes:10},'reminders/snooze'))).status).toBe(409);expect(h.rpc).not.toHaveBeenCalled();});
