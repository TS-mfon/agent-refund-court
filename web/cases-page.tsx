import { useState } from 'react';
import type { CaseManifest } from '../src/domain/schema.js';
import { CaseDetail } from './case-detail.js';
import { Arrow, EmptyCases, Loading, PageHeading, ReadError } from './components.js';
import { displayTime, formatMoney, refundConfirmed, shortHash, sourceLabel, statusLabel } from './model.js';
import { caseTitle, filterCases, type CaseFilter } from './protocol-model.js';
import { Link } from './router.js';
import type { useCases } from './use-cases.js';
export type CasesState=ReturnType<typeof useCases>;
export function CaseCard({caseFile:c}:{caseFile:CaseManifest}) {
 const tone=refundConfirmed(c)?'success':c.status==='accepted'?'accepted':'neutral';
 return <Link className={'case-card '+tone} href={'/cases/'+c.id} aria-label={caseTitle(c)+', '+shortHash(c.id)+', '+statusLabel(c)}>
  <div className="case-card-top"><span className={'status-pill '+tone}>{statusLabel(c)}</span><Arrow diagonal/></div>
  <div className="case-card-symbol" aria-hidden="true">{refundConfirmed(c)?'↩':c.status==='accepted'?'✓':'◇'}</div>
  <h3>{caseTitle(c)}</h3><p className="case-card-brief">{c.agreement.brief}</p>
  <div className="case-card-price"><strong>{formatMoney(c.payment?.amount??c.agreement.amount)} <span>USDC</span></strong><span>{c.payment?.verified?'Payment verified':'Agreed price'}</span></div>
  <div className="case-card-footer"><span>{shortHash(c.id)}</span><span>{sourceLabel(c)}</span></div>
 </Link>;
}
export function CaseGrid({cases}:{cases:readonly CaseManifest[]}){return <div className="case-grid">{cases.map(c=><CaseCard key={c.id} caseFile={c}/>)}</div>;}
export function CaseControls({state,polling,setPolling}:{state:CasesState;polling:boolean;setPolling:(value:boolean)=>void}) {
 return <div className="case-controls"><span className="last-checked">{state.checkedAt?'Checked '+displayTime(state.checkedAt):'Reading case service'}</span><label className="polling-label"><input type="checkbox" checked={polling} onChange={event=>setPolling(event.target.checked)}/><span>Auto-refresh</span></label><button type="button" className="button secondary" disabled={state.loading} onClick={state.refresh}>{state.loading?'Checking…':'Refresh'}</button></div>;
}
export function CasesPage({state,polling,setPolling}:{state:CasesState;polling:boolean;setPolling:(value:boolean)=>void}) {
 const [query,setQuery]=useState(''),[filter,setFilter]=useState<CaseFilter>('all');
 const filtered=filterCases(state.cases,query,filter);
 return <div className="page cases-page"><PageHeading title="Every case tells the whole story.">Published agreements, original answers and receipts. Open a case to inspect the evidence behind its outcome.</PageHeading>
  <div className="cases-toolbar"><label className="search-box"><svg className="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.7"/><path d="M15 15L21 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg><input type="search" aria-label="Search cases" placeholder="Search a brief, case or transaction" value={query} onChange={event=>setQuery(event.target.value)}/></label><label className="status-select"><span>Status</span><select aria-label="Filter cases by status" value={filter} onChange={event=>setFilter(event.target.value as CaseFilter)}><option value="all">All cases</option><option value="refunded">Refund confirmed</option><option value="accepted">Accepted by buyer</option><option value="in-progress">In progress</option><option value="simulation">Simulation</option></select></label></div>
  <CaseControls state={state} polling={polling} setPolling={setPolling}/>
  {state.error?<ReadError message={state.error} retry={state.refresh} stale={Boolean(state.cases.length)}/>:null}
  {state.loading&&!state.cases.length?<Loading/>:null}
  {!state.loading&&!state.error&&!state.cases.length?<EmptyCases/>:null}
  {state.cases.length?<><p className="result-count" role="status">{filtered.length} {filtered.length===1?'case':'cases'}{query||filter!=='all'?' matching your filters':''}</p>{filtered.length?<CaseGrid cases={filtered}/>:<div className="empty-filter"><h2>No case matches those filters.</h2><p>Try a case identifier, a word from the brief, or a different status.</p><button className="button secondary" onClick={()=>{setQuery('');setFilter('all');}}>Clear filters</button></div>}</>:null}
  <div className="library-note"><span className="status-dot"/><p>Base Sepolia and GenLayer Studio testnet cases. A finalized ruling and a confirmed refund are separate pieces of evidence.</p><Link href="/docs/verification">Read the verification rules<Arrow/></Link></div>
 </div>;
}
export function CasePage({state,polling,setPolling}:{state:CasesState;polling:boolean;setPolling:(value:boolean)=>void}) {
 return <div className="page detail-page"><div className="detail-nav"><Link href="/cases">← All cases</Link><CaseControls state={state} polling={polling} setPolling={setPolling}/></div>{state.error?<ReadError message={state.error} retry={state.refresh} stale={Boolean(state.current)}/>:null}{state.loading&&!state.current?<Loading label="Reading the agreement and its receipts…"/>:null}{state.current?<CaseDetail key={state.current.id} caseFile={state.current}/>:!state.loading&&!state.error?<div className="empty-case"><h1>This case is unavailable.</h1><p>Choose a published case to inspect its evidence.</p><Link href="/cases" className="button primary">Browse cases</Link></div>:null}</div>;
}
