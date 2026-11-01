'use client';
import {stopVoice} from './voice/speech';
export const WORK_STOP_EVENT = 'jarvis:stop-work';
export type SessionEvent = 'pause' | 'changed' | 'signedout';
export function stopApplicationWork() {
  stopVoice();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WORK_STOP_EVENT));
}
export function broadcastSession(event: SessionEvent) {
  stopApplicationWork();
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('jarvis-session-events');
    channel.postMessage(event); channel.close();
  }
}
