// Written—not executed. Ordinary Auth identities exercise deployed column grants/RLS.
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {localFixtures} from '../support/local-fixtures';
import type {Database} from '../../src/lib/database.types';
let f:Awaited<ReturnType<typeof localFixtures>>,a:SupabaseClient<Database>,b:SupabaseClient<Database>,oa:string,ob:string;
beforeAll(async()=>{f=await localFixtures();const auth={persistSession:false,autoRefreshToken:false};a=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});b=createClient<Database>(f.status.API_URL,f.status.ANON_KEY,{auth});const aa=await a.auth.signInWithPassword(f.users.alex),bb=await b.auth.signInWithPassword(f.users.sam);if(!aa.data.user||!bb.data.user)throw new Error('Synthetic sign-in failed');oa=aa.data.user.id;ob=bb.data.user.id;});
afterAll(async()=>{await f?.close();});
it('new-account setup/skip is owned and cannot grant cloud/audio/phone permission',async()=>{
 const initial=await a.from('profiles').select('*').eq('owner_id',oa).single();expect(initial.error).toBeNull();expect(initial.data?.onboarding_completed_at).toBeNull();
 const pref=await a.from('privacy_preferences').select('*').eq('owner_id',oa).single();expect(pref.data).toMatchObject({text_cloud:false,notifications:false});
 const saved=await a.from('profiles').update({assistant_name:'Synthetic Pip',tone:'concise',timezone:'Asia/Kolkata',onboarding_completed_at:new Date().toISOString()}).eq('owner_id',oa).select('*').single();expect(saved.error).toBeNull();expect(saved.data?.assistant_name).toBe('Synthetic Pip');
 const after=await a.from('privacy_preferences').select('*').eq('owner_id',oa).single();expect(after.data).toEqual(pref.data);
 expect((await a.from('voice_preferences').select('cloud_transcription').eq('owner_id',oa)).data?.some(v=>v.cloud_transcription)).toBe(false);
});
it('forged setup owner cannot modify B or update ownership; the target stays unchanged',async()=>{
 const before=await b.from('profiles').select('*').eq('owner_id',ob).single();expect(before.error).toBeNull();
 const attack=await a.from('profiles').update({assistant_name:'Must not change',onboarding_completed_at:new Date().toISOString()}).eq('owner_id',ob).select('*');expect(attack.data??[]).toEqual([]);
 expect((await a.from('profiles').update({owner_id:ob}).eq('owner_id',oa)).error).not.toBeNull();
 const after=await b.from('profiles').select('*').eq('owner_id',ob).single();expect(after.data).toEqual(before.data);
});
