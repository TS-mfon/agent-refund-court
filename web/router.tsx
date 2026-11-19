import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { resolveRoute } from './protocol-model.js';
const ROUTE_EVENT='court:navigate';
function subscribe(callback:()=>void) {
 window.addEventListener('popstate',callback);
 window.addEventListener(ROUTE_EVENT,callback);
 return ()=>{window.removeEventListener('popstate',callback);window.removeEventListener(ROUTE_EVENT,callback);};
}
function snapshot(){return window.location.pathname+window.location.search;}
export function navigate(href:string,replace=false) {
 const url=new URL(href,window.location.origin);
 if(url.origin!==window.location.origin)return;
 if(replace)window.history.replaceState(null,'',url.pathname+url.search+url.hash);
 else window.history.pushState(null,'',url.pathname+url.search+url.hash);
 window.dispatchEvent(new Event(ROUTE_EVENT));
 if(!url.hash)window.scrollTo({top:0,behavior:'instant'});
}
export function useRoute() {
 const value=useSyncExternalStore(subscribe,snapshot,()=>'/');
 const separator=value.indexOf('?');
 return resolveRoute(separator<0?value:value.slice(0,separator),separator<0?'':value.slice(separator));
}
export function Link({href='/',onClick,...props}:AnchorHTMLAttributes<HTMLAnchorElement>) {
 function click(event:MouseEvent<HTMLAnchorElement>) {
  onClick?.(event);
  if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || props.download)return;
  const url=new URL(href,window.location.origin);
  if(url.origin!==window.location.origin || !/^\/(cases|services|connect|docs|status)?(\/|$)/.test(url.pathname))return;
  event.preventDefault();navigate(href);
 }
 return <a {...props} href={href} onClick={click}/>;
}
