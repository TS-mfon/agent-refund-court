import {readFile,mkdir,cp,rename,stat,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {openBrowser,renderMedia,renderStill,selectComposition,RenderInternals} from '@remotion/renderer';
import {verifiedCase} from './evidence.mjs';
import {measureMP4} from './mp4.mjs';
const args=process.argv.slice(2),at=args.indexOf('--props'),propsPath=at<0?'case.json':args[at+1];
async function main(){
 const inputProps=JSON.parse(await readFile(propsPath,'utf8'));verifiedCase(inputProps.caseFile);
 for(const path of Object.values(inputProps.assets)){
  if(!['captures/overview.png','captures/delivery.png','captures/receipts.png'].includes(path))throw new Error('Unknown captured asset');
  await stat(resolve('public',path));
 }
 await mkdir('out/qa',{recursive:true});
 const serveUrl=await bundle({entryPoint:resolve('src/index.tsx'),publicDir:resolve('public'),outDir:resolve('.bundle')});
 const browser=await openBrowser('chrome');
 try{
  const composition=await selectComposition({serveUrl,id:'AgentRefundCourt',inputProps,puppeteerInstance:browser});
  if(composition.width!==1920||composition.height!==1080||composition.durationInFrames!==1320||composition.fps!==30)throw new Error('Video format drift');
  for(const frame of [0,200,450,760,1000,1140,1319])await renderStill({serveUrl,composition,inputProps,puppeteerInstance:browser,frame,imageFormat:'png',output:resolve('out/qa/frame-'+frame+'.png')});
  let bucket=-1;
  await renderMedia({serveUrl,composition,inputProps,puppeteerInstance:browser,codec:'h264',pixelFormat:'yuv420p',crf:23,concurrency:4,
   outputLocation:resolve('out/agent-refund-court.new.mp4'),licenseKey:'free-license',
   onProgress:({progress})=>{const next=Math.floor(progress*10);if(next>bucket){bucket=next;console.log('Video render '+Math.round(progress*100)+'%');}}});
 }finally{await browser.close({silent:true});}
 const output='out/agent-refund-court.new.mp4',bytes=await readFile(output);
 if(bytes.length<10000)throw new Error('Video export empty');
 const measured=measureMP4(bytes);
 if(measured.durationSeconds!==44||measured.width!==1920||measured.height!==1080||measured.frames!==1320)throw new Error('MP4 metadata verification failed');
 const ffmpeg=RenderInternals.getExecutablePath({type:'ffmpeg',indent:false,logLevel:'error',binariesDirectory:null});
 execFileSync(ffmpeg,['-v','error','-i',resolve(output),'-f','null','-'],{timeout:45000,stdio:['ignore','pipe','pipe']});
 const sha256=createHash('sha256').update(bytes).digest('hex');
 await rename(output,'out/agent-refund-court.mp4');
 await cp('out/agent-refund-court.mp4','../public/demo.mp4');
 await cp('out/qa/frame-1140.png','../public/demo-poster.png');
 let revision='unknown';try{revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 const sourceFiles=['src/index.tsx','src/video.tsx','src/copy.mjs','evidence.mjs','render.mjs','capture.ts'];
 const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,createHash('sha256').update(await readFile(name)).digest('hex')])));
 const captureHashes=Object.fromEntries(await Promise.all(Object.entries(inputProps.assets).map(async([name,path])=>[name,createHash('sha256').update(await readFile('public/'+path)).digest('hex')])));
 const record={sourceHashes,captureHashes,composition:'AgentRefundCourt',...measured,codec:'H.264',decoded:true,
  audio:'Intentional silent captions; no generated footage or narration.',caseId:inputProps.caseFile.id,
  origin:inputProps.origin,sourceRevision:revision,captureTime:inputProps.capturedAt,
  payment:inputProps.caseFile.payment.transactionHash,court:inputProps.caseFile.court.transactionHash,refund:inputProps.caseFile.refund.transactionHash,
  outputBytes:bytes.length,sha256,renderCommand:'npm run render -- --props case.json',
  aiAssistance:'AI-authored Remotion motion graphics, editing, and captions. Product imagery is browser capture.',
  remotionVersion:'4.0.545',seed:'Not applicable: deterministic frame-based composition.',createdAt:new Date().toISOString()};
 await writeFile('provenance.json',JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({rendered:true,...record}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Render failed');process.exitCode=1;});
