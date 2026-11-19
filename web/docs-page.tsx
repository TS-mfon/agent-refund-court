import { useEffect, useState, type ReactNode } from 'react';
import { docsArticles } from './docs-content.js';
import { Arrow, CopyButton } from './components.js';
import { safeExternalUrl } from './model.js';
import { searchDocs, type DocArticle } from './protocol-model.js';
import { Link } from './router.js';
const aliases:Record<string,string>={'getting-started':'quickstart','services':'protocol','verification':'evidence'};
export function InlineText({text}:{text:string}) {
 const pattern=/(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
 const pieces:ReactNode[]=[];let position=0;
 for(const match of text.matchAll(pattern)){
  const index=match.index??0;
  if(index>position)pieces.push(text.slice(position,index));
  if(match[2])pieces.push(<strong key={index}>{match[2]}</strong>);
  else if(match[3])pieces.push(<code key={index}>{match[3]}</code>);
  else {
   const href=match[5]??'',internal=href.startsWith('/docs/'),safe=safeExternalUrl(href);
   pieces.push(internal?<Link key={index} href={href}>{match[4]}</Link>:safe?<a key={index} href={safe} target="_blank" rel="noopener noreferrer">{match[4]}</a>:<span key={index}>{match[4]}</span>);
  }
  position=index+match[0].length;
 }
 if(position<text.length)pieces.push(text.slice(position));
 return <>{pieces}</>;
}
function Article({article}:{article:DocArticle}) {
 return <article className="doc-article"><header><span className="doc-category">{article.category}</span><h1>{article.title}</h1><p>{article.summary}</p></header>{article.sections.map(section=><section className="doc-section" key={section.id} id={section.id}><h2><a href={'#'+section.id}>{section.title}<span aria-hidden="true">#</span></a></h2>{section.paragraphs?.map((text,index)=><p key={index}><InlineText text={text}/></p>)}{section.bullets?.length?<ul>{section.bullets.map((text,index)=><li key={index}><InlineText text={text}/></li>)}</ul>:null}{section.code?<div className="doc-code"><CopyButton value={section.code} label="Copy code"/><pre><code>{section.code}</code></pre></div>:null}{section.links?.length?<div className="doc-links">{section.links.map(link=>{const internal=link.href.startsWith('/docs/'),href=internal?link.href:safeExternalUrl(link.href);return href?internal?<Link key={href} href={href}>{link.label}<Arrow/></Link>:<a key={href} href={href} target="_blank" rel="noopener noreferrer">{link.label}<Arrow diagonal/></a>:null;})}</div>:null}</section>)}</article>;
}
export function DocsPage({slug}:{slug:string}) {
 const [query,setQuery]=useState(''),[sidebar,setSidebar]=useState(false);
 const articles:readonly DocArticle[]=docsArticles;
 const article=articles.find(value=>value.slug===(aliases[slug]??slug));
 const results=searchDocs(articles,query),categories=[...new Set(results.map(value=>value.category))];
 useEffect(()=>{setSidebar(false);document.title=(article?.title??'Documentation')+' — Agent Refund Court';},[article?.slug]);
 const index=articles.findIndex(value=>value.slug===article?.slug),previous=articles[index-1],next=articles[index+1];
 return <div className="docs-layout"><aside className={'docs-sidebar '+(sidebar?'expanded':'')} aria-label="Documentation navigation"><button className="docs-menu-toggle" type="button" aria-expanded={sidebar} onClick={()=>setSidebar(value=>!value)}>Browse documentation<span aria-hidden="true">{sidebar?'−':'+'}</span></button><div className="docs-nav-content"><Link href="/docs/introduction" className="docs-brand">Protocol documentation</Link><label className="search-box docs-search"><svg viewBox="0 0 24 24" className="icon" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.6"/><path d="M15 15L21 21" stroke="currentColor" strokeWidth="1.6"/></svg><input aria-label="Search documentation" type="search" placeholder="Search documentation" value={query} onChange={event=>setQuery(event.target.value)}/></label>{query?<p className="doc-search-count" role="status">{results.length} matching articles</p>:null}{categories.map(category=><div className="doc-nav-group" key={category}><h2>{category}</h2>{results.filter(value=>value.category===category).map(value=><Link key={value.slug} href={'/docs/'+value.slug} aria-current={article?.slug===value.slug?'page':undefined}>{value.title}</Link>)}</div>)}{!results.length?<p className="no-doc-results">No articles match. Try “payment”, “wallet” or “refund”.</p>:null}<a className="docs-source" href="https://github.com/TS-mfon/agent-refund-court/tree/feat/working-demo/docs" target="_blank" rel="noopener noreferrer">Documentation source<Arrow diagonal/></a></div></aside><div className="docs-reading">{article?<><Article article={article}/><nav className="doc-pagination" aria-label="Adjacent documentation">{previous?<Link href={'/docs/'+previous.slug}><span>Previous</span><strong>{previous.title}</strong></Link>:<span/>}{next?<Link href={'/docs/'+next.slug}><span>Next</span><strong>{next.title}</strong><Arrow/></Link>:null}</nav></>:<article className="doc-article"><h1>This article could not be found.</h1><p>Choose a page from the documentation navigation.</p><Link className="button primary" href="/docs/quickstart">Get started<Arrow/></Link></article>}</div>{article?<aside className="docs-toc" aria-label="On this page"><span>On this page</span>{article.sections.map(section=><a href={'#'+section.id} key={section.id}>{section.title}</a>)}</aside>:null}</div>;
}
