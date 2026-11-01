import {it,expect,vi,afterEach} from 'vitest';
import {availability,availabilityLabel,historyPolicy,formatTimestamp,ViewGeneration} from '../../src/lib/workspace';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PreferencesForm} from '../../src/components/preferences-form';
import {AssistantWorkspace} from '../../src/components/assistant-workspace';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
afterEach(()=>vi.unstubAllGlobals());
it('separates configuration, enablement, consent and effective authorization',()=>{
 expect(availability(false,true,true,true)).toBe('not_configured');
 expect(availability(true,false,true,true)).toBe('not_enabled');
 expect(availability(true,true,false,true)).toBe('consent_required');
 expect(availability(true,true,true,false)).toBe('unavailable');
 expect(availability(true,true,true,true)).toBe('ready');
 expect(availabilityLabel('consent_required')).toContain('separate permission is off');
});
it('retention copy reflects the saved policy and never invents a default on read failure',()=>{
 for(const days of [7,30,90,365])expect(historyPolicy(days)).toContain(`${days} days`);
 expect(historyPolicy()).not.toContain('30');expect(historyPolicy()).toContain('Privacy Center');
});
it('metadata dates have an explicit zone and do not silently follow the device zone',()=>{
 expect(formatTimestamp('2026-10-31T20:00:00Z','Asia/Kolkata')).toMatch(/1 Nov 2026.*01:30.*Asia\/Kolkata/);
 expect(formatTimestamp('invalid')).toBe('Date unavailable');
 expect(formatTimestamp('2026-10-31T20:00:00Z','invalid')).toContain('20:00:00.000Z · UTC');
});
it('late asynchronous results cannot apply after a newer view or session invalidation',async()=>{
 const scope=new ViewGeneration();let complete!:(v:string)=>void;const older=scope.next();
 const response=new Promise<string>(r=>{complete=r;});let content='current';
 const task=response.then(v=>{if(scope.current(older))content=v;});scope.next();complete('old-account-content');await task;
 expect(content).toBe('current');const active=scope.next();expect(scope.current(active)).toBe(true);scope.invalidate();expect(scope.current(active)).toBe(false);
});
it('quick setup initially renders three preferences with skip and no permission or automatic data action',()=>{
 const html=renderToStaticMarkup(createElement(PreferencesForm,{mode:'welcome',initial:{display_name:'',assistant_name:'Pip',tone:'balanced',timezone:'Asia/Kolkata',locale:'en-IN'}}));
 for(const text of ['Quick workspace setup','Assistant name','Communication style','Timezone','Skip optional setup','grants no cloud, microphone or notification permission'])expect(html).toContain(text);
 expect(html).not.toContain('Display name');expect(html).not.toContain('type="checkbox"');expect(html).toContain('<fieldset disabled');
});
it('initial Assistant suggestions only draft text and keep development fault controls out of product copy',()=>{
 const html=renderToStaticMarkup(createElement(AssistantWorkspace));
 expect(html).toContain('never send or save automatically');expect(html).toContain('Draft a memory request');expect(html).not.toContain('/mock fail');expect(html).toContain('retention follows your Privacy Center');
});
it('a session pause stops streams and voice locally without persisting or broadcasting credentials',async()=>{
 const target=new EventTarget(),received:string[]=[];target.addEventListener('jarvis:stop-work',()=>received.push('work'));target.addEventListener('jarvis:stop-voice',()=>received.push('voice'));
 const sent:unknown[]=[];class Channel{postMessage(v:unknown){sent.push(v);}close(){}}
 vi.stubGlobal('window',target);vi.stubGlobal('BroadcastChannel',Channel);
 const {broadcastSession}=await import('../../src/lib/session-events');broadcastSession('pause');
 expect(received).toEqual(['voice','work']);expect(sent).toEqual(['pause']);
});
