'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {stopApplicationWork} from '@/lib/session-events';
export function PrivacyBoundary(){
 const path=usePathname();
 useEffect(()=>{const frame=requestAnimationFrame(()=>document.getElementById('main')?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[path]);
 useEffect(()=>{
  const session=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('jarvis-session-events');
  if(session)session.onmessage=e=>{if(!['pause','changed','signedout','signout'].includes(e.data))return;stopApplicationWork();if(e.data==='changed'||e.data==='signedout')window.location.replace(e.data==='changed'?'/assistant':'/sign-in?notice=signed-out');};
  const privacy=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('jarvis-privacy-events');
  if(privacy)privacy.onmessage=e=>{if(e.data!=='data'&&e.data!=='account')return;stopApplicationWork();window.location.replace(e.data==='account'?'/privacy/deletion':'/settings#privacy-center');};
  const restored=(e:PageTransitionEvent)=>{if(e.persisted){stopApplicationWork();window.location.reload();}};
  window.addEventListener('pageshow',restored);
  return()=>{session?.close();privacy?.close();window.removeEventListener('pageshow',restored);};
 },[]);return null;
}
