import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadPrivateEnvironment } from './private-config.js';
async function main(){
 const env=await loadPrivateEnvironment();
 const result=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'});
 if(result.status!==0)throw new Error('Unable to inspect release files');
 const wallets=JSON.parse(await readFile(join(homedir(),'.config','agent-refund-court','wallets.json'),'utf8')) as Record<string,{privateKey:string}>;
 const walletSecrets=Object.values(wallets).map(w=>w.privateKey);
 const paths=[...new Set(result.stdout.split('\0').filter(Boolean))];
 const names=['GEMINI_API_KEY','DEMO_ACCESS_TOKEN','BLOB_READ_WRITE_TOKEN','SELLER_PRIVATE_KEY','RECEIPT_SIGNER_PRIVATE_KEY','GENLAYER_REGISTRAR_PRIVATE_KEY'];
 for(const path of paths){
  if(path.startsWith('.env')&&path!=='.env.example')throw new Error('Private environment included');
  if(path.endsWith('.mp4')||path.endsWith('.png')||path.endsWith('.jpg'))continue;
  const text=await readFile(path,'utf8');
  if(names.some(name=>env[name]&&text.includes(env[name]))||walletSecrets.some(value=>text.includes(value)))throw new Error('Secret found in '+path);
 }
 console.log('Release secret scan passed: '+paths.length+' files checked');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Release check failed');process.exitCode=1;});
