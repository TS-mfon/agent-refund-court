import { randomUUID } from 'node:crypto';
import { type StateStore,type Stored,StorageConflict } from './store.js';
import { hashContent } from '../domain/identity.js';
export type Lease={token:string;owner:string;generation:number;expiresAt:number};
export type FencedState={revision:number;fence:number;lease:Lease|null;artifactKey?:string|null;status?:string};
export type LeaseGrant<T extends FencedState=FencedState>=Stored<T>&{lease:Lease};
const terminal=new Set(['DELIVERED','OPERATIONAL_REFUND_APPROVED','OPERATIONAL_REFUND_PENDING','REFUND_CONFIRMED']);
function available(value:FencedState) {
  return !value.artifactKey&&!terminal.has(value.status??'');
}
export async function acquireLease<T extends FencedState=FencedState>(store:StateStore,key:string,options:{
  owner:string;now:number;ttlMs:number
}):Promise<LeaseGrant<T>> {
  if(!Number.isSafeInteger(options.now)||options.now<0||!Number.isSafeInteger(options.ttlMs)||
    options.ttlMs<1||options.ttlMs>300_000||!options.owner||options.owner.length>100)throw new Error('Invalid lease');
  const current=await store.get<T>(key);
  if(!current||!available(current.value)||(current.value.lease&&current.value.lease.expiresAt>options.now))
    throw new StorageConflict(key);
  const lease={owner:options.owner,token:randomUUID(),generation:current.value.fence+1,expiresAt:options.now+options.ttlMs};
  const next={...current.value,revision:current.value.revision+1,fence:lease.generation,lease};
  return {...await store.compareAndSwap(key,next,current.etag),lease};
}
function owns(value:FencedState,lease:Lease,now:number) {
  return available(value)&&value.fence===lease.generation&&value.lease?.token===lease.token&&value.lease.expiresAt>now;
}
/** Candidate is immutable; only the pointer selected by current ETag and fence is deliverable. */
export async function commitArtifact<T extends FencedState=FencedState,A=unknown>(store:StateStore,key:string,
  grant:LeaseGrant<T>,artifactKey:string,artifact:A,now:number,
  patch:Partial<Omit<T,'revision'|'fence'|'lease'|'artifactKey'>>={}
):Promise<Stored<T>> {
  if(!Number.isSafeInteger(now)||now<0)throw new Error('Invalid commitment time');
  let current=await store.get<T>(key);
  if(!current||!owns(current.value,grant.lease,now))throw new StorageConflict(key);
  try {await store.create(artifactKey,artifact);}
  catch(error) {
    if(!(error instanceof StorageConflict))throw error;
    const existing=await store.get<A>(artifactKey);
    if(!existing||hashContent(existing.value)!==hashContent(artifact))throw new StorageConflict(artifactKey);
  }
  current=await store.get<T>(key);
  if(!current||!owns(current.value,grant.lease,now))throw new StorageConflict(key);
  const next={...current.value,...patch,revision:current.value.revision+1,
    fence:current.value.fence,lease:null,artifactKey} as T;
  return store.compareAndSwap(key,next,current.etag);
}
