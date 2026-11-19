import { useEffect, useRef, useState } from 'react';
import { Arrow } from './components.js';
import { Link } from './router.js';
const steps=[
 {title:'Agree on the work',name:'Trade',tag:'Buyer ↔ Seller',detail:'Your agent commits to a brief, price and quality rubric. The x402 payment unlocks the work.',code:'brief + rubric + USDC'},
 {title:'Review what arrived',name:'Dispute',tag:'Evidence committed',detail:'The buyer checks the original answer. A material failure becomes a claim tied to specific agreed criteria.',code:'answer + claim + evidence'},
 {title:'Let the court decide',name:'Ruling',tag:'Internet Court on GenLayer',detail:'GenLayer evaluates the bounded evidence independently. A provisional result must reach finality.',code:'REFUND / NO_REFUND'},
 {title:'Follow the money back',name:'Refund',tag:'Receipt verified on Base',detail:'A final refund award starts the seller’s refund process. A matching transfer confirms the money returned.',code:'ruling → seller → buyer'},
];
export function CommerceFlow(){
 const [step,setStep]=useState(0),[playing,setPlaying]=useState(false),[reduced,setReduced]=useState(false),[visible,setVisible]=useState(true);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>{setReduced(media.matches);if(media.matches)setPlaying(false);};
  update();media.addEventListener('change',update);
  const observer=new IntersectionObserver(entries=>setVisible(Boolean(entries[0]?.isIntersecting) && document.visibilityState==='visible'),{threshold:.15});
  if(root.current)observer.observe(root.current);
  const visibility=()=>setVisible(document.visibilityState==='visible' && Boolean(root.current && root.current.getBoundingClientRect().bottom>0 && root.current.getBoundingClientRect().top<window.innerHeight));
  document.addEventListener('visibilitychange',visibility);
  return()=>{media.removeEventListener('change',update);observer.disconnect();document.removeEventListener('visibilitychange',visibility);};
 },[]);
 useEffect(()=>{
  if(!playing || reduced || !visible)return;
  const timer=setInterval(()=>setStep(value=>(value+1)%steps.length),3200);
  return()=>clearInterval(timer);
 },[playing,reduced,visible]);
 const current=steps[step]!;
 return <div ref={root} className="commerce-flow" data-playing={playing && visible && !reduced} data-reduced-motion={reduced}>
  <div className="flow-topline"><span className="flow-label"><span className="status-dot"/>Explore the protocol</span><button className="flow-play" type="button" aria-pressed={playing} disabled={reduced} onClick={()=>setPlaying(value=>!value)}>{playing?'Pause':'Play'}<span aria-hidden="true">{playing?'Ⅱ':'▷'}</span></button></div>
  <div className="flow-canvas" aria-hidden="true">
   <svg className="flow-wires" viewBox="0 0 540 240" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="wire" x1="0" x2="1"><stop stopColor="#5374ff"/><stop offset="1" stopColor="#39d8e6"/></linearGradient></defs><path className="wire-base" d="M111 111H429M270 112V211M111 111Q111 34 270 34Q429 34 429 111"/><path className="wire-active" d={step===0?'M111 111H429':step===1?'M429 111Q429 34 270 34':step===2?'M270 34Q111 34 111 111':'M270 211V112H111'}/><circle className="wire-junction" cx="270" cy="111" r="7"/></svg>
   <div className={'agent-orb buyer '+(step===0 || step===3?'active':'')}><svg viewBox="0 0 48 48" fill="none"><rect x="8" y="13" width="32" height="25" rx="10" stroke="currentColor" strokeWidth="2"/><path d="M24 13V7M18 38V42M30 38V42" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="18" cy="24" r="2.5" fill="currentColor"/><circle cx="30" cy="24" r="2.5" fill="currentColor"/><path d="M18 31H30" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg><span>Buyer agent</span></div>
   <div className={'agent-orb seller '+(step===0 || step===1?'active':'')}><svg viewBox="0 0 48 48" fill="none"><path d="M8 18H40L36 8H12L8 18ZM10 18V40H38V18M18 40V27H30V40" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M8 18C8 24 16 24 16 18C16 24 24 24 24 18C24 24 32 24 32 18C32 24 40 24 40 18" stroke="currentColor" strokeWidth="2"/></svg><span>Seller agent</span></div>
   <div className={'court-orb '+(step===2?'active':'')}><svg viewBox="0 0 40 40" fill="none"><path d="M8 15L20 8L32 15M10 17H30M12 19V29M20 19V29M28 19V29M8 32H32" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg><span>Internet Court</span></div>
   <div className={'flow-token token-'+step}>{step===0?'$':step===1?'?':step===2?'⚖':'↩'}</div>
  </div>
  <div className="flow-tabs" aria-label="Explore protocol stages">{steps.map((value,index)=><button key={value.name} type="button" aria-pressed={step===index} className={step===index?'active':''} onClick={()=>{setPlaying(false);setStep(index);}}><span className="step-number">{index+1}</span>{value.name}</button>)}</div>
  <div className="flow-story" aria-live="polite"><div><span className="flow-tag">{current.tag}</span><h3>{current.title}</h3><p>{current.detail}</p></div><code>{current.code}</code></div>
  <Link className="flow-link" href="/docs/protocol">How the protocol works<Arrow/></Link>
 </div>;
}
