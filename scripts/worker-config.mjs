import { readFileSync, statSync } from 'node:fs';
import { root, assertLocalUrl } from './local-runtime.mjs';
export function readWorkerConfig() {
 const file=new URL('.local/worker.json',root);
 if ((statSync(file).mode & 0o077)!==0) throw new Error('Worker configuration must be private (chmod 600 .local/worker.json).');
 const config=JSON.parse(readFileSync(file,'utf8'));
 assertLocalUrl(config.connection,54322);
 const u=new URL(config.connection);
 if(u.username!=='jarvis_reminder_worker' || !u.password || u.pathname!=='/postgres') throw new Error('Worker requires the restricted local runtime principal.');
 return config.connection;
}
