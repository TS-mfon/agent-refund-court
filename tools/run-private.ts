import { spawn } from 'node:child_process';
import { loadPrivateEnvironment } from './private-config.js';
const scripts:Record<string,string>={model:'tools/check-model.ts',check:'tools/check-live.ts',demo:'tools/demo.ts',worker:'tools/process-cases.ts',proof:'tools/verify-proof.ts',dev:'tools/dev.ts'};
async function main(){
 const [mode,...args]=process.argv.slice(2),script=scripts[mode];
 if(!script)throw new Error('Unknown private operation');
 const settings=await loadPrivateEnvironment();
 const child=spawn(process.execPath,['--use-env-proxy','--import','tsx',script,...args],{env:{...process.env,...settings},stdio:'inherit'});
 child.on('error',()=>{console.error('Private operation could not start.');process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;});
}
main().catch(()=>{console.error('Private operation configuration failed; no credentials printed.');process.exitCode=1;});
