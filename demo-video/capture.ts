import {mkdir,writeFile,cp,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from '@playwright/test';
import {CaseManifestSchema} from '../src/domain/schema.js';
import {verifiedCase} from './evidence.mjs';
const args=process.argv.slice(2);
const value=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
async function main(){
 const raw=value('--origin')??'https://agent-refund-court.vercel.app',origin=new URL(raw);
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.protocol!=='https:')throw new Error('Use an HTTPS service origin');
 const id=value('--case');if(!id||!/^0x[0-9a-fA-F]{64}$/.test(id))throw new Error('A real case id is required');
 const response=await fetch(origin.origin+'/api/v1/cases/'+id,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Case fetch failed');
 const body=await response.text();if(Buffer.byteLength(body)>65536)throw new Error('Case too large');
 const caseFile=CaseManifestSchema.parse(JSON.parse(body).case);
 if(args.includes('--probe')){console.log(JSON.stringify({caseId:caseFile.id,status:caseFile.status,refund:caseFile.refund?.status,refundVerified:caseFile.refund?.verified}));return;}
 verifiedCase(caseFile);
 if(caseFile.id.toLowerCase()!==id.toLowerCase())throw new Error('Case identity mismatch');
 const dir=resolve('public/captures');await mkdir(dir,{recursive:true});
 await cp('../public/logos','public/logos',{recursive:true});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
  await page.goto(origin.origin+'/?case='+id,{waitUntil:'networkidle',timeout:45000});
  await page.getByText('Refund confirmed',{exact:true}).first().waitFor();
  await page.screenshot({path:join(dir,'overview.png')});
  await page.locator('.delivery-section').screenshot({path:join(dir,'delivery.png')});
  await page.locator('.receipts').screenshot({path:join(dir,'receipts.png')});
  const errors=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  if(errors)throw new Error('Capture has horizontal overflow');
 }finally{await browser.close();}
 const props={caseFile,origin:origin.origin,capturedAt:new Date().toISOString(),assets:{overview:'captures/overview.png',delivery:'captures/delivery.png',receipts:'captures/receipts.png'}};
 await writeFile('case.json',JSON.stringify(props,null,2)+'\n');
 for(const name of Object.values(props.assets))if((await stat('public/'+name)).size<1000)throw new Error('Capture image missing');
 console.log(JSON.stringify({captured:true,caseId:caseFile.id,props:'demo-video/case.json',mode:caseFile.mode}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Capture failed');process.exitCode=1;});
