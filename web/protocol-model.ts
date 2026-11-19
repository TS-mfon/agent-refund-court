import type { CaseManifest } from '../src/domain/schema.js';
import { refundConfirmed, statusLabel, sourceLabel } from './model.js';
import { initialSelection } from './presentation.js';

export type Route = { page: 'home' | 'cases' | 'services' | 'connect' | 'status' | 'not-found' } | {page:'case';id:string} | {page:'docs';slug:string};
export type CaseFilter = 'all' | 'refunded' | 'accepted' | 'in-progress' | 'simulation';
export type DocSection = {id:string;title:string;paragraphs?:readonly string[];code?:string;bullets?:readonly string[];links?:readonly {label:string;href:string}[]};
export type DocArticle = {slug:string;title:string;summary:string;category:string;sections:readonly DocSection[]};
export function resolveRoute(pathname:string, search:string):Route {
 const path=pathname.replace(/\/+$/, '') || '/';
 const legacy=path==='/' ? initialSelection(search) : null;
 if(legacy) return {page:'case',id:legacy};
 const caseMatch=/^\/cases\/(0x[0-9a-fA-F]{64})$/.exec(path);
 if(caseMatch) return {page:'case',id:caseMatch[1]!};
 const docMatch=/^\/docs\/([a-z0-9-]+)$/.exec(path);
 if(docMatch) return {page:'docs',slug:docMatch[1]!};
 if(path==='/docs') return {page:'docs',slug:'getting-started'};
 const routes:Record<string,Route>={'/':{page:'home'},'/cases':{page:'cases'},'/services':{page:'services'},'/connect':{page:'connect'},'/status':{page:'status'}};
 return routes[path] ?? {page:'not-found'};
}
export function filterCases(cases:readonly CaseManifest[],query:string,filter:CaseFilter):CaseManifest[] {
 const term=query.trim().toLocaleLowerCase();
 return cases.filter(c=>{
  const match=filter==='all' || (filter==='refunded' && refundConfirmed(c)) || (filter==='accepted' && c.status==='accepted') || (filter==='simulation' && c.mode==='simulation') || (filter==='in-progress' && c.mode!=='simulation' && !refundConfirmed(c) && c.status!=='accepted');
  const searchable=[c.id,c.agreement.brief,c.agreement.serviceId,statusLabel(c),sourceLabel(c),c.payment?.transactionHash,c.refund?.transactionHash].filter(Boolean).join(' ').toLocaleLowerCase();
  return match && (!term || searchable.includes(term));
 });
}
export function caseTitle(c:CaseManifest):string {
 return c.agreement.serviceId==='launch-plan-v1' ? 'First-week launch plan' : 'Agent digital work';
}
export function utf8Length(value:string):number {return new TextEncoder().encode(value).length;}
export function buildAgentTask(origin:string,serviceId:string,brief:string):string {
 const url=new URL(origin);
 if(!['https:','http:'].includes(url.protocol) || url.username || url.password || (url.protocol==='http:' && !['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Use a valid HTTPS service origin.');
 if(!brief.trim()) throw new Error('Write a brief before copying the task.');
 if(utf8Length(brief)>1200) throw new Error('The brief must be at most 1,200 bytes.');
 if(!/^[a-z0-9-]{1,80}$/.test(serviceId)) throw new Error('Select a valid service.');
 return ['Use the Agent Refund Court skill or MCP tools.', 'Service origin: '+url.origin, 'Service: '+serviceId, '', 'Brief:', brief.trim(), '', 'Read the current service, price, network and quality rubric first. Use the merchant allowlist and spending limits in my configured mandate. Ask for approval before any action outside that mandate. Keep wallet signing local. Buy the work, review the committed answer against the agreed rubric, and accept it or submit a specific evidence-backed dispute. Return the published case link and verified receipts.'].join('\n');
}
export function searchDocs<T extends DocArticle>(articles:readonly T[],query:string):T[] {
 const term=query.trim().toLocaleLowerCase();
 return articles.filter(a=>!term || [a.title,a.summary,a.category,...a.sections.flatMap(s=>[s.title,...s.paragraphs??[],...s.bullets??[],s.code??''])].join(' ').toLocaleLowerCase().includes(term));
}
export function serviceOrigin():string {
 if(typeof window==='undefined') return 'https://agent-refund-court.vercel.app';
 return window.location.port==='5173' ? 'http://127.0.0.1:3001' : window.location.origin;
}
