'use client';
import {stopApplicationWork} from '../session-events';
export function notifyPrivacyChange(account=false){
 stopApplicationWork();if(typeof BroadcastChannel!=='undefined'){const c=new BroadcastChannel('jarvis-privacy-events');c.postMessage(account?'account':'data');c.close();}
}
