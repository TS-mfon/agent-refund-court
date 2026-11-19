import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill} from '@remotion/renderer';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
async function main(){
 await mkdir('out/qa',{recursive:true});
 const serveUrl=await bundle({entryPoint:resolve('src/index.tsx'),publicDir:resolve('public'),outDir:resolve('.bundle')});
 const browser=await openBrowser('chrome');
 try{
  const composition=await selectComposition({serveUrl,id:'AgentRefundCourt',puppeteerInstance:browser});
  await renderStill({serveUrl,composition,puppeteerInstance:browser,output:resolve('out/qa/preflight.png')});
  console.log(JSON.stringify({preflight:true,width:composition.width,height:composition.height,frames:composition.durationInFrames,fps:composition.fps}));
 }finally{await browser.close({silent:true});}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Preflight failed');process.exitCode=1;});
