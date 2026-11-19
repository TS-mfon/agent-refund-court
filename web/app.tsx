import { useEffect, useState } from 'react';
import { CourtMark } from './brand.js';
import { CasePage, CasesPage } from './cases-page.js';
import { Arrow, REPOSITORY } from './components.js';
import { ConnectPage } from './connect-page.js';
import { DocsPage } from './docs-page.js';
import { HomePage } from './home-page.js';
import { Link, navigate, useRoute } from './router.js';
import { ServicesPage } from './services-page.js';
import { StatusPage, useActivity } from './activity.js';
import { useCases } from './use-cases.js';
const nav=[{href:'/cases',label:'Cases'},{href:'/services',label:'Services'},{href:'/docs/getting-started',label:'Docs'}];
function ThemeButton({theme,setTheme}:{theme:'light'|'dark';setTheme:(value:'light'|'dark')=>void}) {
 return <button type="button" className="theme-button" aria-label={'Switch to '+(theme==='light'?'night':'day')+' mode'} onClick={()=>setTheme(theme==='light'?'dark':'light')}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{theme==='light'?<path d="M20 15.2A8.5 8.5 0 0 1 8.8 4A8.5 8.5 0 1 0 20 15.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>:<><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7"/><path d="M12 2V4M12 20V22M2 12H4M20 12H22M5 5L6.5 6.5M17.5 17.5L19 19M5 19L6.5 17.5M17.5 6.5L19 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></>}</svg></button>;
}
export function App(){
 const route=useRoute(),[polling,setPolling]=useState(true),[menu,setMenu]=useState(false);
 const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{return localStorage.getItem('arc:theme:v1')==='dark'?'dark':'light';}catch{return 'light';}});
 const state=useCases(route.page==='case'?route.id:null,polling&&(route.page==='home'||route.page==='cases'||route.page==='case'));
 const activity=useActivity();
 useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('arc:theme:v1',theme);}catch{/* Theme still applies when storage is unavailable. */}},[theme]);
 useEffect(()=>{
  setMenu(false);
  const title=route.page==='home'?'Agent Refund Court — good work, fair outcomes':route.page==='case'?'Case evidence — Agent Refund Court':route.page==='docs'?'Documentation — Agent Refund Court':route.page.charAt(0).toUpperCase()+route.page.slice(1)+' — Agent Refund Court';
  document.title=title;
  if(route.page==='case'&&window.location.pathname==='/')navigate('/cases/'+route.id,true);
 },[route.page,route.page==='case'?route.id:route.page==='docs'?route.slug:'']);
 return <><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><Link className="app-identity" href="/" aria-label="Agent Refund Court home"><CourtMark/><span>Agent<br/><strong>Refund Court</strong></span></Link><nav className={'main-nav '+(menu?'menu-open':'')} id="main-navigation" aria-label="Main navigation">{nav.map(item=><Link key={item.href} href={item.href} aria-current={route.page===(item.label==='Docs'?'docs':item.label.toLowerCase())?'page':undefined}>{item.label}</Link>)}<a href={REPOSITORY} target="_blank" rel="noopener noreferrer" className="source-link">Source<Arrow diagonal/></a></nav><div className="header-actions"><ThemeButton theme={theme} setTheme={setTheme}/><Link href="/connect" className="button primary connect-cta">Connect agent<Arrow/></Link><button className="menu-button" type="button" aria-label={menu?'Close navigation':'Open navigation'} aria-expanded={menu} aria-controls="main-navigation" onClick={()=>setMenu(value=>!value)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={menu?'M6 6L18 18M6 18L18 6':'M4 7H20M4 12H20M4 17H20'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></button></div></header>
  <main className="site-main" id="main" key={route.page==='docs'?'docs':route.page} tabIndex={-1}>{route.page==='home'?<HomePage state={state}/>:route.page==='cases'?<CasesPage state={state} polling={polling} setPolling={setPolling}/>:route.page==='case'?<CasePage state={state} polling={polling} setPolling={setPolling}/>:route.page==='services'?<ServicesPage/>:route.page==='connect'?<ConnectPage/>:route.page==='docs'?<DocsPage slug={route.slug}/>:route.page==='status'?<StatusPage activity={activity} state={state}/>:<div className="page empty-case"><h1>That page could not be found.</h1><p>Browse the protocol, published cases or developer documentation.</p><Link href="/" className="button primary">Go home<Arrow/></Link></div>}</main>
  <footer className="site-footer"><div className="footer-brand"><CourtMark/><div><strong>Agent Refund Court</strong><p>Clear agreements. Verifiable outcomes.</p></div></div><div className="footer-links"><Link href="/docs/protocol">Protocol</Link><Link href="/status">Service status</Link><a href="/demo.mp4" target="_blank" rel="noopener noreferrer">Watch demo</a><a href={REPOSITORY} target="_blank" rel="noopener noreferrer">GitHub<Arrow diagonal/></a></div><div className="footer-bottom"><span>Built for the Internet Court Builders Working Group.</span><span>Base Sepolia + GenLayer Studio testnets</span></div></footer></>;
}
