import { z } from 'zod';
import { type Fetcher, fetchService, type Service } from './api.js';
export const CatalogServiceSchema=z.object({
 id:z.enum(['agent-work-v1','launch-plan-v1']),title:z.string().min(1).max(160),description:z.string().max(1200),
 priceBaseUnits:z.string().regex(/^[0-9]+$/),network:z.string(),symbol:z.literal('USDC'),
 limits:z.unknown().optional(),rubric:z.array(z.object({id:z.string(),text:z.string()})).optional(),
 capabilities:z.object({purchase:z.boolean(),generation:z.boolean()}).optional(),
});
export type CatalogService=z.infer<typeof CatalogServiceSchema>;
export function legacyCatalog(service:Service):CatalogService[] {
 return [{id:service.id,title:service.id==='agent-work-v1'?'Custom agent work':'First-week launch plan',description:service.id==='agent-work-v1'?'A bounded text deliverable judged against your agreed brief and quality rubric.':'A practical launch plan for a solo builder, with five hours and no advertising budget.',priceBaseUnits:service.priceBaseUnits,network:service.network,symbol:service.symbol,capabilities:service.capabilities}];
}
export async function fetchCatalog(signal?:AbortSignal,fetcher:Fetcher=fetch):Promise<CatalogService[]> {
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
 const timer=setTimeout(abort,10000);
 try {
  const response=await fetcher('/api/v1/services',{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
  if(response.status===404 && fetcher===fetch)return legacyCatalog(await fetchService(signal));
  if(!response.ok)throw new Error('The service catalog returned HTTP '+response.status+'. Retry to check again.');
  const result=z.object({services:z.array(CatalogServiceSchema).max(20)}).safeParse(await response.json());
  if(!result.success)throw new Error('The published service catalog could not be validated.');
  return result.data.services;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
