export async function hidden(label){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Use a normal interactive terminal for private credential entry.');
 process.stdout.write(`${label}: `);process.stdin.setRawMode(true);process.stdin.resume();let value='';
 return new Promise((resolve,reject)=>{const done=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',onData);process.stdout.write('\n');};
  const onData=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){done();reject(new Error('Local setup cancelled.'));return;}if(c==='\r'||c==='\n'){done();resolve(value);return;}if(c==='\u007f'){value=value.slice(0,-1);}else if(c>=' '){value+=c;}}};process.stdin.on('data',onData);
 });
}
