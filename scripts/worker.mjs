import { readWorkerConfig } from './worker-config.mjs';
import { startWorker } from '../src/worker/runtime.ts';
import { safeDiagnostic } from './safe-diagnostics.mjs';
let worker;
try{
 worker=await startWorker(readWorkerConfig(),process.env.M2B_TEST_RUN??null);
 console.log(JSON.stringify({worker:'running',notification:'per_reminder_channel',webRequired:false}));
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;try{await worker.stop();process.exitCode=0;}catch{process.exitCode=1;}};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}catch(error){console.error(JSON.stringify({blockedOrFailed:true,...safeDiagnostic(error,'reminder_worker_start')}));process.exitCode=1;}
