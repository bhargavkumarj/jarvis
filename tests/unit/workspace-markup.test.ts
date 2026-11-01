import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryWorkspace} from '../../src/components/memory-workspace';
import {AssistantWorkspace} from '../../src/components/assistant-workspace';
import {ReminderWorkspace} from '../../src/components/reminder-workspace';
// Initial server markup only: no effects, network, login bypass or browser/a11y
// claim. Interactive, focus and persistence checks remain in real Playwright.
it('initial memory markup distinguishes loading from confirmed empty records',()=>{
 const html=renderToStaticMarkup(createElement(MemoryWorkspace));
 expect(html).toContain('Loading pending proposals');expect(html).toContain('Loading approved memories');
 expect(html).not.toContain('No approved memories yet');expect(html).not.toContain('Approve exact memory');
});
it('initial Assistant markup labels its mock and does not invent history or receipts',()=>{
 const html=renderToStaticMarkup(createElement(AssistantWorkspace));
 expect(html).toContain('Loading conversation history');expect(html).toContain('Conversation provider');expect(html).toContain('Deterministic mock provider');
 expect(html).not.toContain('No retained conversations yet');expect(html).not.toContain('Application operation receipts');
});
it('reminder markup has explicit date/zone/channel controls and no confirmation before review',()=>{
 const html=renderToStaticMarkup(createElement(ReminderWorkspace,{timezone:'Asia/Kolkata'}));
 for(const text of ['Local date and time','Reminder timezone','Delivery channel','Review exact schedule'])expect(html).toContain(text);
 expect(html).not.toContain('Confirm exact reminder');expect(html).toContain('<fieldset disabled');
});
it('initial recurrence markup exposes fixed-zone and clock-policy review without inventing occurrences',()=>{
 const html=renderToStaticMarkup(createElement(ReminderWorkspace,{timezone:'Asia/Kolkata'}));
 for(const text of ['Recurring reminders','Fixed series timezone','Inclusive end date','Lateness window in minutes','repeated times use the earlier instant','Preview recurring schedule'])expect(html).toContain(text);
 expect(html).toContain('Loading series');expect(html).not.toContain('Confirm exact recurring schedule');expect(html).not.toContain('No recurring reminders yet');
});
it('voice markup discloses cloud processing, keeps typing and never starts capture or playback on render',()=>{
 const html=renderToStaticMarkup(createElement(AssistantWorkspace));
 expect(html).toContain('Push to talk');expect(html).toContain('Start microphone recording');expect(html).toContain('Cloud transcription and privacy');expect(html).toContain('No raw audio is saved');expect(html).toContain('Deterministic mock');
 expect(html).not.toContain('Transcribe recording');expect(html).not.toContain('Use transcript in message');expect(html).not.toContain('Read completed reply aloud');expect(html).toContain('id="message"');
});
