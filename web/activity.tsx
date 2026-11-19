import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Arrow, PageHeading } from './components.js';
import type { CasesState } from './cases-page.js';
import { displayTime, statusLabel } from './model.js';
import { Link } from './router.js';
const HealthSchema=z.object({status:z.string(),success:z.boolean().optional()});
const ActivitySchema=z.object({status:z.string().optional(),automation:z.object({enabled:z.boolean()}).passthrough().optional(),lastWakeAt:z.string().nullable().optional(),lastRunAt:z.string().nullable().optional(),pendingCases:z.number().int().nonnegative().optional()}).passthrough();
export function useActivity(){
 const [health,setHealth]=useState<string|null>(null),[activity,setActivity]=useState<z.infer<typeof ActivitySchema>|null>(null),[error,setError]=useState<string|null>(null),[checkedAt,setCheckedAt]=useState<string|null>(null),[refreshKey,setRefreshKey]=useState(0),[wakeError,setWakeError]=useState<string|null>(null);
 const refresh=useCallback(()=>setRefreshKey(value=>value+1),[]);
 useEffect(()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);async function load(){const results=await Promise.allSettled([fetch('/api/v1/health',{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Health check returned HTTP '+response.status);return HealthSchema.parse(await response.json());}),fetch('/api/v1/activity/status',{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)return null;return ActivitySchema.parse(await response.json());})]);if(controller.signal.aborted)return;const h=results[0]!,a=results[1]!;if(h.status==='fulfilled'){setHealth(h.value.status);setError(null);}else setError('The service health check could not be read.');if(a.status==='fulfilled')setActivity(a.value);setCheckedAt(new Date().toISOString());}void load();return()=>{controller.abort();clearTimeout(timer);};},[refreshKey]);
 const wakeEnabled=activity?.automation?.enabled===true;
 useEffect(()=>{
  if(!wakeEnabled)return;
  let active=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
  async function wake(){
   try{
    const response=await fetch('/api/v1/activity/wake',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal,cache:'no-store'});
    if(!response.ok)throw new Error('Automation wake returned HTTP '+response.status);
    const result=ActivitySchema.parse(await response.json());
    if(!controller.signal.aborted){setActivity(result);setWakeError(null);}
   }catch{if(active)setWakeError(controller.signal.aborted?'Visitor automation is still pending. Existing jobs remain recoverable.':'Visitor automation could not be resumed. Existing jobs remain recoverable.');}
  }
  void wake();
  return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[wakeEnabled,refreshKey]);
 return {health,activity,error,checkedAt,refresh,wakeError};
}
export function StatusPage({activity,state}:{activity:ReturnType<typeof useActivity>;state:CasesState}){
 return <div className="page status-page"><PageHeading title="Read the current service state.">Service health and case status come directly from the published API.</PageHeading><div className="status-banner"><span className={'health-orb '+(activity.health==='ok'?'ok':'')}/><div><h2>{activity.error?'Health check unavailable':activity.health==='ok'?'API responding':activity.health?'API status: '+activity.health:'Checking the API…'}</h2><p>{activity.checkedAt?'Checked '+displayTime(activity.checkedAt):'Reading the service response.'}</p></div><button type="button" className="button secondary" onClick={()=>{activity.refresh();state.refresh();}}>Check again</button></div>
 <div className="status-grid"><section><h2>Agent purchases</h2><strong>{state.service?state.service.capabilities.purchase?'Enabled':'Unavailable':'Metadata unavailable'}</strong><p>Availability reported by the merchant service.</p><Link href="/services">Service catalog<Arrow/></Link></section><section><h2>Work generation</h2><strong>{state.service?state.service.capabilities.generation?'Enabled':'Unavailable':'Metadata unavailable'}</strong><p>Model-backed delivery capability reported by the service.</p><Link href="/docs/hosting">Hosting and configuration<Arrow/></Link></section><section><h2>Settlement networks</h2><strong>Base Sepolia</strong><p>Payments and refunds use testnet USDC. Court judgment runs on GenLayer Studio.</p><Link href="/docs/protocol">Protocol architecture<Arrow/></Link></section></div>
 <section className="status-cases"><div className="section-heading"><div><h2>Published case states</h2><p>A court award only becomes a confirmed refund after transfer verification.</p></div><Link href="/cases">Inspect cases<Arrow/></Link></div>{state.cases.length?<div className="status-case-list">{state.cases.map(c=><Link key={c.id} href={'/cases/'+c.id}><span>{c.agreement.serviceId}</span><code>{c.id.slice(0,12)}…</code><span className="status-pill">{statusLabel(c)}</span><Arrow/></Link>)}</div>:<p>No published cases have been loaded.</p>}</section>
 {activity.wakeError?<p className="status-note" role="status">{activity.wakeError}</p>:null}
 {activity.activity?<details className="activity-metadata"><summary>Published automation metadata</summary><p>The service exposes these safe worker fields.</p><pre>{JSON.stringify(activity.activity,null,2)}</pre></details>:<p className="status-note">Automation metadata is unavailable. Existing case status remains visible through the case API.</p>}
 </div>;
}
