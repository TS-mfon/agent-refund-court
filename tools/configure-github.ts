import { spawnSync } from 'node:child_process';
import { loadPrivateEnvironment } from './private-config.js';
async function main(){
 const env=await loadPrivateEnvironment();if(!env.DEMO_ACCESS_TOKEN)throw new Error('Token required');
 const r=spawnSync('gh',['secret','set','DEMO_ACCESS_TOKEN','--repo','TS-mfon/agent-refund-court'],{input:env.DEMO_ACCESS_TOKEN,encoding:'utf8',timeout:30000});
 if(r.status!==0)throw new Error('GitHub worker secret configuration failed');
 console.log('GitHub worker token configured without exposing it.');
}
main().catch(()=>{console.error('GitHub worker configuration failed.');process.exitCode=1;});
