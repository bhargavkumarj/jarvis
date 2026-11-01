// HTTP mocks only. No real login, account mutation, Docker or database call.
import {beforeEach,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({login:vi.fn(),from:vi.fn(),supabase:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../src/lib/config',()=>({getConfig:()=>({APP_ORIGIN:'http://127.0.0.1:3000'})}));
vi.mock('../../src/lib/supabase',()=>({supabase:h.supabase,identity:vi.fn()}));
import {POST} from '../../src/app/api/v1/auth/[action]/route';
function req(origin='http://127.0.0.1:3000'){return new Request('http://127.0.0.1:3000/api/v1/auth/sign-in',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'alex@example.test',password:'SYNTHETIC_PASSWORD_ONLY'})});}
const params={params:Promise.resolve({action:'sign-in'})};
beforeEach(()=>{vi.clearAllMocks();h.supabase.mockResolvedValue({auth:{signInWithPassword:h.login},from:h.from});});
it.each([{status:0,name:'AuthRetryableFetchError'},{status:503}])('transport failure is 503 with no profile query or successful redirect: %j',async error=>{
 h.login.mockResolvedValue({error:{...error,message:'PRIVATE_PROVIDER_SENTINEL'}});const response=await POST(req(),params);expect(response.status).toBe(503);const d=await response.json();expect(d.redirect).toBeUndefined();expect(d.error).toContain('Local sign-in service');expect(JSON.stringify(d)).not.toContain('PRIVATE_PROVIDER_SENTINEL');expect(h.from).not.toHaveBeenCalled();
});
it('invalid password remains opaque and cannot advance to profile access',async()=>{h.login.mockResolvedValue({error:{status:400,code:'invalid_credentials'}});expect((await POST(req(),params)).status).toBe(401);expect(h.from).not.toHaveBeenCalled();});
it('connection handling never bypasses the existing origin gate',async()=>{expect((await POST(req('https://foreign.example'),params)).status).toBe(403);expect(h.supabase).not.toHaveBeenCalled();});
