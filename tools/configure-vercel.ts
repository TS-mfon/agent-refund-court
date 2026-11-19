import { randomBytes } from 'node:crypto';
import { readFile,writeFile,chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadPrivateEnvironment,privateDirectory } from './private-config.js';
import { loadConfig } from '../src/config.js';
const project='prj_JLfjR4DuM1CwPLdR7Jvo2R3uG8vz',scope='gen-daves-projects';
let phase='configuration';
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==0&&(args.length!==2||args[0]!=='--model'||!/^gemini-(2\.5|3\.1|3\.5)-flash-lite$/.test(args[1])))throw new Error('Invalid configure arguments');
 const target=join(privateDirectory,'runtime.json');let current:Record<string,string>={};
 try{current=JSON.parse(await readFile(target,'utf8'));}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const runtime={...current,SERVICE_ORIGIN:'https://agent-refund-court.vercel.app',DEMO_ACCESS_TOKEN:current.DEMO_ACCESS_TOKEN??randomBytes(32).toString('hex'),...(args[1]?{MODEL_ID:args[1]}:{})};
 await writeFile(target,JSON.stringify(runtime),{mode:0o600});await chmod(target,0o600);
 const env=await loadPrivateEnvironment();loadConfig(env);
 const names=['SERVICE_ORIGIN','GENLAYER_CONTRACT','GENLAYER_NETWORK','GENLAYER_RPC_URL','SELLER_ADDRESS','SELLER_PRIVATE_KEY',
 'RECEIPT_SIGNER_PRIVATE_KEY','GENLAYER_REGISTRAR_PRIVATE_KEY','GEMINI_API_KEY','MODEL_ID','DEMO_ACCESS_TOKEN',
 'BLOB_STORE_ID','BASE_RPC_URL','PRICE_BASE_UNITS','X402_FACILITATOR_URL'];
 if(env.BLOB_READ_WRITE_TOKEN)names.push('BLOB_READ_WRITE_TOKEN');
 const values=names.map(name=>({key:name,value:env[name],type:'encrypted',target:['production','preview','development']}));
 if(values.some(v=>!v.value))throw new Error('Missing required environment');
 phase='vercel-api';
 const credentials=process.env.VERCEL_TOKEN??(JSON.parse(await readFile(join(homedir(),'.local','share','com.vercel.cli','auth.json'),'utf8')) as {token:string}).token;
 if(!credentials)throw new Error('Vercel authentication required');
 const response=await fetch('https://api.vercel.com/v10/projects/'+project+'/env?upsert=true&teamId=team_B7dvHnmHyByeFo4TYAaVOheF',{
  method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+credentials},body:JSON.stringify(values),signal:AbortSignal.timeout(30000),
 });
 if(!response.ok){
  const failure=await response.json() as {error?:{code?:string}};
  console.error(JSON.stringify({phase,status:response.status,code:failure.error?.code??'VERCEL_ENV_FAILED'}));
  throw new Error('Vercel configuration failed');
 }
 console.log(JSON.stringify({configured:true,project,environmentNames:names,model:env.MODEL_ID,privateTokenFile:target}));
}
main().catch(()=>{console.error(JSON.stringify({phase,error:'PRIVATE_CONFIGURATION_FAILED'}));process.exitCode=1;});
