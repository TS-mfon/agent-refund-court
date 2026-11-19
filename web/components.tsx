import { useEffect, useState, type ReactNode } from 'react';
import { CourtMark } from './brand.js';
import { Link } from './router.js';
export const REPOSITORY='https://github.com/TS-mfon/agent-refund-court';
export function Arrow({diagonal=false}:{diagonal?:boolean}) {return <svg className="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal?'M6 18L18 6M6 6H18V18':'M4 12H20M13 5L20 12L13 19'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
export function CopyButton({value,label='Copy',disabled=false}:{value:string;label?:string;disabled?:boolean}) {
 const [state,setState]=useState<'idle'|'copied'|'failed'>('idle');
 useEffect(()=>{setState('idle');},[value]);
 useEffect(()=>{if(state==='idle')return;const timer=setTimeout(()=>setState('idle'),3000);return()=>clearTimeout(timer);},[state]);
 async function copy(){try{await navigator.clipboard.writeText(value);setState('copied');}catch{setState('failed');}}
 return <div className="copy-control"><button className="button secondary" type="button" disabled={disabled} onClick={()=>void copy()}>{state==='copied'?'Copied':label}<svg className="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M15 8V5A2 2 0 0 0 13 3H5A2 2 0 0 0 3 5V13A2 2 0 0 0 5 15H8" stroke="currentColor" strokeWidth="1.5"/></svg></button><span className={state==='failed'?'copy-feedback':'visually-hidden'} role="status">{state==='failed'?'Copy unavailable. Select and copy the text below.':state==='copied'?'Copied to clipboard.':''}</span></div>;
}
export function PageHeading({title,children,aside}:{title:string;children?:ReactNode;aside?:ReactNode}) {return <header className="page-heading"><div><h1>{title}</h1>{children?<p>{children}</p>:null}</div>{aside}</header>;}
export function EmptyCases(){return <div className="empty-case"><CourtMark/><h3>No case has been published yet.</h3><p>Use an agent to purchase work. Its agreement, committed answer and verified receipts will appear here.</p><Link className="button primary" href="/connect">Run with an agent<Arrow/></Link></div>;}
export function ReadError({message,retry,stale=false}:{message:string;retry:()=>void;stale?:boolean}){return <div className="service-error" role="alert"><strong>The case service could not be read.</strong><p>{message}</p>{stale?<p>Previously loaded evidence is still visible. Its status may have changed.</p>:null}<button className="button secondary" type="button" onClick={retry}>Retry</button></div>;}
export function Loading({label='Reading published cases…'}:{label?:string}){return <div className="loading-state" role="status"><span className="loading-ring" aria-hidden="true"/><p>{label}</p></div>;}
