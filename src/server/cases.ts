import { CaseManifestSchema, HashSchema, type CaseManifest } from '../domain/schema.js';
import { hashContent } from '../domain/identity.js';
import { type StateStore, type Stored, StorageConflict } from '../storage/index.js';
import { ApiError } from './types.js';

const key = (id: string) => 'cases/' + HashSchema.parse(id) + '.json';
export class CaseRepository {
  constructor(private readonly store: StateStore) {}
  async get(id: string): Promise<Stored<CaseManifest>> {
    const saved = await this.store.get(key(id));
    if (!saved) throw new ApiError('CASE_NOT_FOUND', 404, 'This case could not be found.');
    const value = CaseManifestSchema.parse(saved.value);
    if (value.id.toLowerCase() !== id.toLowerCase()) throw new ApiError('CASE_CONTEXT_CONFLICT', 503, 'Case evidence did not match its identifier.');
    return { value, etag: saved.etag };
  }
  async list(): Promise<CaseManifest[]> {
    const keys = await this.store.list('cases/', 100);
    const cases = await Promise.all(keys.map(async path => {
      if (!/^cases\/0x[0-9a-fA-F]{64}\.json$/.test(path)) throw new ApiError('CASE_CONTEXT_CONFLICT', 503, 'The case list contains an invalid identifier.');
      return (await this.get(path.slice(6, -5))).value;
    }));
    return cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(input: CaseManifest): Promise<CaseManifest> {
    const parsed = CaseManifestSchema.parse(input);
    try { return (await this.store.create(key(parsed.id), parsed)).value; }
    catch (error) {
      if (!(error instanceof StorageConflict)) throw error;
      const existing = await this.get(parsed.id);
      if (hashContent(existing.value.agreement) !== hashContent(parsed.agreement) || hashContent(existing.value.delivery) !== hashContent(parsed.delivery) ||
        hashContent(existing.value.payment) !== hashContent(parsed.payment)) throw new ApiError('CASE_CONTEXT_CONFLICT', 409, 'The original case evidence cannot be changed.');
      return existing.value;
    }
  }
  async patch(saved: Stored<CaseManifest>, patch: Partial<CaseManifest>) {
    const next = CaseManifestSchema.parse({ ...saved.value, ...patch });
    return this.store.compareAndSwap(key(next.id), next, saved.etag);
  }
}
