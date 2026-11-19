import { hashContent } from '../domain/identity.js';
import { AddressSchema } from '../domain/schema.js';
import type { StateStore } from '../storage/index.js';
/** Separate buyer wallets while sharing one per-wallet mandate across all merchants. */
export function buyerStore(store: StateStore, address: string): StateStore {
  const prefix = 'wallets/' + AddressSchema.parse(address).toLowerCase() + '/';
  return scopedStore(store, prefix);
}
export function merchantStore(store: StateStore, origin: string): StateStore {
  return scopedStore(store, 'merchants/' + hashContent(origin).slice(2) + '/');
}
function scopedStore(store: StateStore, prefix: string): StateStore {
  return {
    get: key => store.get(prefix + key),
    create: (key, value) => store.create(prefix + key, value),
    compareAndSwap: (key, value, etag) => store.compareAndSwap(prefix + key, value, etag),
    list: async (key, limit) => (await store.list(prefix + key, limit)).map(path => path.slice(prefix.length)),
  };
}
