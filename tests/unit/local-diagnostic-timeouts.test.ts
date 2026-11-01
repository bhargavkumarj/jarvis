// Mocked subprocess/HTTP boundaries only: never contacts Docker or a database.
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({exec:vi.fn()}));
vi.mock('node:child_process',()=>({execFileSync:h.exec}));
import {runLocalCli,diagnosticFetch} from '../../scripts/local-runtime.mjs';
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('DOCKER_HOST','');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('bounds only read-only context/status helpers and keeps local project targeting',()=>{
 h.exec.mockReturnValueOnce('unix:///var/run/docker.sock').mockReturnValueOnce('SAFE_STATUS');
 expect(runLocalCli(['status','-o','json'])).toBe('SAFE_STATUS');
 expect(h.exec.mock.calls[0][2]).toMatchObject({timeout:5000,killSignal:'SIGKILL'});
 expect(h.exec.mock.calls[1][1]).toEqual(['status','-o','json']);
 expect(h.exec.mock.calls[1][2]).toMatchObject({timeout:10000,killSignal:'SIGKILL'});
});
it('status timeout exposes a fixed phase, suppresses captured secrets and does not retry',()=>{
 h.exec.mockReturnValueOnce('unix:///var/run/docker.sock').mockImplementationOnce(()=>{throw Object.assign(new Error('PRIVATE_SENTINEL'),{code:'ETIMEDOUT',stdout:'PRIVATE_SENTINEL'});});
 expect(()=>runLocalCli(['status','-o','json'])).toThrow('status timed out after 10 seconds');
 expect(h.exec).toHaveBeenCalledTimes(2);
});
it('context timeout never starts Supabase or reflects a private endpoint',()=>{
 h.exec.mockImplementation(()=>{throw Object.assign(new Error('PRIVATE_SENTINEL'),{code:'ETIMEDOUT',stderr:'PRIVATE_SENTINEL'});});
 let message='';try{runLocalCli(['status','-o','json']);}catch(e){message=(e as Error).message;}
 expect(message).toContain('context inspection timed out');expect(message).not.toContain('PRIVATE_SENTINEL');expect(h.exec).toHaveBeenCalledOnce();
});
it('does not introduce a kill timeout on mutating migration execution',()=>{
 h.exec.mockReturnValueOnce('unix:///var/run/docker.sock').mockReturnValueOnce('SAFE_SUCCESS');
 runLocalCli(['migration','up','--local']);expect(h.exec.mock.calls[1][2]).not.toHaveProperty('timeout');
});
it('Auth diagnostic fetch preserves upstream cancellation and adds a bounded request signal',async()=>{
 const upstream=new AbortController(),fetch=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',fetch);
 await diagnosticFetch('http://127.0.0.1:54321/auth/v1/admin/users',{signal:upstream.signal,method:'GET'});
 const options=fetch.mock.calls[0] as unknown as [string,RequestInit];const bounded=options[1].signal!;
 expect(bounded).not.toBe(upstream.signal);expect(bounded.aborted).toBe(false);upstream.abort();expect(bounded.aborted).toBe(true);
});
