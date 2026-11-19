import { get,put,list,head,BlobPreconditionFailedError,BlobError,type GetCommandOptions } from '@vercel/blob';
import { type StateStore,type Stored,StorageConflict,storageKey,serializeState,MAX_STATE_BYTES,listLimit } from './store.js';
type BlobCommandOptions = Pick<GetCommandOptions,'token'|'storeId'|'abortSignal'>;
export interface BlobTransport {
  head?(key:string,options:BlobCommandOptions):Promise<{etag:string;size:number}>;
  get(key:string,options:BlobCommandOptions & {access:'private';useCache:false;headers:{'Accept-Encoding':'identity'}}):Promise<{
    statusCode:number;blob:{etag:string;size:number|null};stream:ReadableStream<Uint8Array>|null
  }|null>;
  put(key:string,body:string,options:BlobCommandOptions & {
    access:'private';addRandomSuffix:false;contentType:'application/json';allowOverwrite?:false;ifMatch?:string
  }):Promise<{etag:string}>;
  list(options:BlobCommandOptions & {prefix:string;limit:number;cursor?:string}):Promise<{
    blobs:{pathname:string}[];hasMore:boolean;cursor?:string
  }>;
}
export class BlobStateStore implements StateStore {
  private readonly transport:BlobTransport;
  private readonly auth:BlobCommandOptions;
  constructor(options:{token?:string;storeId?:string;transport?:BlobTransport}) {
    this.transport=options.transport??{get,put,list,head};
    this.auth={...(options.token?{token:options.token}:{}),...(options.storeId?{storeId:options.storeId}:{})};
  }
  async get<T>(key:string):Promise<Stored<T>|null> {
    const result=await this.transport.get(storageKey(key),{...this.auth,access:'private',useCache:false,headers:{'Accept-Encoding':'identity'}});
    if(!result)return null;
    if(result.statusCode!==200||!result.stream||!result.blob.etag)throw new Error('Fresh storage read unavailable');
    if(result.blob.size!==null&&result.blob.size>MAX_STATE_BYTES) {
      await result.stream.cancel();throw new Error('State exceeds byte limit');
    }
    const reader=result.stream.getReader(),parts:Uint8Array[]=[];
    let size=0;
    try {
      while(true) {
        const chunk=await reader.read();if(chunk.done)break;
        size+=chunk.value.byteLength;
        if(size>MAX_STATE_BYTES){await reader.cancel();throw new Error('State exceeds byte limit');}
        parts.push(chunk.value);
      }
    } finally {reader.releaseLock();}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
    const value=JSON.parse(text) as T;serializeState(value);
    let etag=result.blob.etag;
    if(etag.startsWith('W/')){
      if(!this.transport.head)throw new Error('Strong storage version unavailable');
      const metadata=await this.transport.head(storageKey(key),this.auth);
      if(!/^"[\x21\x23-\x7e]{1,250}"$/.test(metadata.etag)||
         metadata.etag!==etag.slice(2)||metadata.size!==size)
        throw new Error('Storage version changed during read');
      etag=metadata.etag;
    }
    return {value,etag};
  }
  async create<T>(key:string,value:T):Promise<Stored<T>> {
    return this.write(key,value,{allowOverwrite:false});
  }
  async compareAndSwap<T>(key:string,value:T,etag:string):Promise<Stored<T>> {
    if(typeof etag!=='string'||!etag||etag.startsWith('W/')||etag.length>256)throw new StorageConflict(key);
    return this.write(key,value,{ifMatch:etag});
  }
  private async write<T>(key:string,value:T,condition:{allowOverwrite?:false;ifMatch?:string}):Promise<Stored<T>> {
    storageKey(key);const text=serializeState(value);
    try {
      const result=await this.transport.put(key,text,{...this.auth,access:'private',
        addRandomSuffix:false,contentType:'application/json',...condition});
      if(!result.etag)throw new Error('Storage returned no ETag');
      return {value:JSON.parse(text) as T,etag:result.etag};
    } catch(error) {
      if(error instanceof BlobPreconditionFailedError || (condition.allowOverwrite===false && error instanceof BlobError && error.message.startsWith('Vercel Blob: This blob already exists,')))throw new StorageConflict(key);
      throw error;
    }
  }
  async list(prefix:string,limit=1000):Promise<string[]> {
    storageKey(prefix,true);listLimit(limit);
    const keys:string[]=[];let cursor:string|undefined;
    for(let page=0;page<10&&keys.length<limit;page++) {
      const result=await this.transport.list({...this.auth,prefix,limit:Math.min(100,limit-keys.length),...(cursor?{cursor}:{})});
      for(const blob of result.blobs) {
        storageKey(blob.pathname);
        if(!blob.pathname.startsWith(prefix))throw new Error('Storage returned an invalid prefix');
        keys.push(blob.pathname);
      }
      if(!result.hasMore)break;
      if(!result.cursor||result.cursor===cursor)throw new Error('Storage returned an invalid cursor');
      cursor=result.cursor;
    }
    return [...new Set(keys)].sort().slice(0,limit);
  }
}
