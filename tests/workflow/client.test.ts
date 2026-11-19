import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { LocalStateStore } from '../../src/workflow/local-store.js';
import { StorageConflict } from '../../src/storage/index.js';
import { demoOrigin, DemoHttpError, apiRequest, apiJSON, cliArguments } from '../../src/workflow/http.js';
test('demo origin excludes non-http schemes, credentials and arbitrary paths', () => {
  assert.equal(demoOrigin('https://court.example/'), 'https://court.example');
  assert.equal(demoOrigin('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  for (const input of ['file:///etc/passwd', 'http://external.example', 'https://u:p@court.example', 'https://court.example/api']) assert.throws(() => demoOrigin(input));
});
test('client does not expose a private provider error body', async () => {
  await assert.rejects(apiRequest('https://court.example', 'private-test-token', '/api/v1/health',
    undefined, async () => Response.json({ error: 'secret upstream token' }, { status: 502 })), error =>
      error instanceof DemoHttpError && error.message === 'HTTP_502' && !error.message.includes('secret'));
});
test('local state uses create-only writes and rejects stale CAS and traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arc-local-'));
  try {
    const store = new LocalStateStore(directory), first = await store.create('buyer/orders/a.json', { n: 1 });
    await assert.rejects(store.create('buyer/orders/a.json', { n: 2 }), StorageConflict);
    const next = await store.compareAndSwap('buyer/orders/a.json', { n: 2 }, first.etag);
    await assert.rejects(store.compareAndSwap('buyer/orders/a.json', { n: 3 }, first.etag), StorageConflict);
    assert.equal((await store.get<{n:number}>('buyer/orders/a.json'))?.value.n, 2);
    assert.notEqual(next.etag, first.etag);
    await assert.rejects(store.get('../private.json'));
    assert.deepEqual(await store.list('buyer/orders/'), ['buyer/orders/a.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('authenticated JSON requests validate response schemas and preserve intentional POST data', async () => {
  let submitted: unknown;
  const fetcher: typeof fetch = async (_url, init) => { submitted = JSON.parse(String(init?.body)); return Response.json({ caseId: 'case-1' }); };
  assert.deepEqual(await apiJSON('https://court.example', 'private-test-token', '/api/v1/cases', z.object({ caseId: z.string() }), { hello: 'world' }, fetcher),
    { caseId: 'case-1' });
  assert.deepEqual(submitted, { hello: 'world' });
  await assert.rejects(apiJSON('https://court.example', 'private-test-token', '/api/v1/cases',
    z.object({ caseId: z.string() }), undefined, async () => Response.json({ cases: [] })));
});
test('missing credentials and paths outside the service API cannot be requested', async () => {
  let calls=0;const fetcher:typeof fetch=async()=>{calls+=1;return Response.json({});};
  await assert.rejects(apiRequest('https://court.example','','/api/v1/cases',undefined,fetcher),/INVALID_REQUEST/);
  await assert.rejects(apiRequest('https://court.example','token','/private',undefined,fetcher),/INVALID_REQUEST/);
  assert.equal(calls,0);
  const response=await apiRequest('https://court.example','token','/api/v1/cases',undefined,async()=>new Response(null,{status:402}));
  assert.equal(response.status,402);
});
test('command flags must have one unambiguous value', () => {
  assert.deepEqual(cliArguments(['--origin','https://court.example','--scenario','bad']),{origin:'https://court.example',scenario:'bad'});
  for(const values of [['--origin'],['origin','value'],['--origin','x','--origin','y'],['--origin','--scenario']])
    assert.throws(()=>cliArguments(values),/INVALID_ARGUMENTS/);
});
test('local private state rejects corrupted rows, symlinks, and stale mutation attempts', async () => {
  const directory=await mkdtemp(join(tmpdir(),'arc-local-invalid-'));
  try {
    const store=new LocalStateStore(directory);assert.equal(await store.get('missing.json'),null);
    await assert.rejects(store.compareAndSwap('missing.json',{n:1},'missing'),StorageConflict);
    await writeFile(join(directory,'invalid.json'),JSON.stringify({etag:'',value:{n:1}}));
    await assert.rejects(store.get('invalid.json'),/LOCAL_STATE_INVALID/);
    await symlink(join(directory,'invalid.json'),join(directory,'linked.json'));
    await assert.rejects(store.get('linked.json'),/LOCAL_STATE_SYMLINK/);
    await assert.rejects(store.list(''),/Invalid storage key/);
    await assert.rejects(store.list('buyer/',0),/Invalid storage list limit/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('HTTP conflicts expose only the validated server error code', async () => {
  await assert.rejects(apiRequest('https://court.example', 'private-test-token', '/api/v1/orders',
    { method: 'POST', body: '{}' }, async () => Response.json({
      error: { code: 'STATE_CONFLICT', message: 'credential-bearing upstream details', headers: { Authorization: 'private-api-secret' } },
    }, { status: 409 })), error =>
      error instanceof DemoHttpError && error.code === 'HTTP_409' && error.serverErrorCode === 'STATE_CONFLICT' &&
      !JSON.stringify(error).includes('credential') && !JSON.stringify(error).includes('private-api-secret'));
});
test('invalid JSON or credential-like diagnostic codes never replace the safe HTTP error', async () => {
  for (const code of ['private-secret', 'apiKey=private', 'a'.repeat(90), 123, null]) {
    await assert.rejects(apiRequest('https://court.example', 'private-test-token', '/api/v1/orders',
      undefined, async () => Response.json({ error: { code, message: 'private secret' } }, { status: 503 })), error =>
        error instanceof DemoHttpError && error.message === 'HTTP_503' && error.serverErrorCode === undefined);
  }
  await assert.rejects(apiRequest('https://court.example', 'private-test-token', '/api/v1/orders', undefined,
    async () => new Response('<html>private upstream credentials</html>', { status: 502 })), error =>
      error instanceof DemoHttpError && error.message === 'HTTP_502' && error.serverErrorCode === undefined);
});
