import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, rename, unlink, readdir, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type StateStore, type Stored, storageKey, serializeState, listLimit, StorageConflict } from '../storage/index.js';
/** Buyer-only local state. Atomic links/CAS locks preserve the original authorization on retries. */
export class LocalStateStore implements StateStore {
  private readonly root: string;
  constructor(directory: string) { this.root = resolve(directory); }
  private async path(key: string) {
    storageKey(key); const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const parts = key.split('/'); let current = this.root;
    for (const part of ['', ...parts]) {
      if (part) current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('LOCAL_STATE_SYMLINK'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return path;
  }
  async get<T>(key: string): Promise<Stored<T> | null> {
    const path = await this.path(key);
    try {
      const row = JSON.parse(await readFile(path, 'utf8')) as Stored<T>;
      if (typeof row.etag !== 'string' || !row.etag) throw new Error('LOCAL_STATE_INVALID');
      serializeState(row.value); return row;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  private async locked<T>(key: string, operation: (path: string) => Promise<T>): Promise<T> {
    const path = await this.path(key), lock = path + '.lock';
    try { await writeFile(lock, randomUUID(), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageConflict(key); throw error; }
    try { return await operation(path); } finally { await unlink(lock); }
  }
  async create<T>(key: string, value: T): Promise<Stored<T>> {
    serializeState(value); const row = { etag: randomUUID(), value };
    return this.locked(key, async path => {
      const temporary = path + '.' + row.etag + '.tmp';
      await writeFile(temporary, JSON.stringify(row), { flag: 'wx', mode: 0o600 });
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageConflict(key); throw error; }
      finally { await unlink(temporary); }
      return { etag: row.etag, value: JSON.parse(serializeState(value)) as T };
    });
  }
  async compareAndSwap<T>(key: string, value: T, etag: string): Promise<Stored<T>> {
    serializeState(value);
    return this.locked(key, async path => {
      const current = await this.get<T>(key); if (!current || current.etag !== etag) throw new StorageConflict(key);
      const row = { etag: randomUUID(), value }, temporary = path + '.' + row.etag + '.tmp';
      await writeFile(temporary, JSON.stringify(row), { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
      return { etag: row.etag, value: JSON.parse(serializeState(value)) as T };
    });
  }
  async list(prefix: string, limit = 1000): Promise<string[]> {
    storageKey(prefix, true); listLimit(limit); await mkdir(this.root, { recursive: true, mode: 0o700 });
    let output: string[] = [];
    const walk = async (relative: string) => {
      const entries = await readdir(join(this.root, relative), { withFileTypes: true });
      for (const entry of entries) {
        if (output.length >= limit) return;
        const key = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isSymbolicLink()) throw new Error('LOCAL_STATE_SYMLINK');
        if (entry.isDirectory()) await walk(key);
        else if (entry.isFile() && key.endsWith('.json') && key.startsWith(prefix)) output = [...output, key];
      }
    };
    await walk(''); return output.sort();
  }
}
