import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCases, fetchCase } from '../../web/api.js';
import { sampleCase } from './sample.js';

test('case reads use actual same-origin API and validate the response', async () => {
  const calls: string[] = [];
  const fetcher = async (url: string | URL | Request) => { calls.push(String(url)); return new Response(JSON.stringify({ cases: [sampleCase()] }), { status: 200 }); };
  assert.equal((await fetchCases(undefined, fetcher)).length, 1);
  assert.deepEqual(calls, ['/api/v1/cases']);
});
test('HTTP and invalid JSON responses expose retryable errors', async () => {
  await assert.rejects(fetchCases(undefined, async () => new Response('down', { status: 503 })), /503/);
  await assert.rejects(fetchCases(undefined, async () => new Response('{', { status: 200 })), /read/i);
  await assert.rejects(fetchCases(undefined, async () => new Response(JSON.stringify({ cases: [{ status: 'refunded' }] }))), /validation/i);
});
test('case identifier is validated before issuing a request', async () => {
  let called = false;
  await assert.rejects(fetchCase('../secret', undefined, async () => { called = true; return new Response('{}'); }), /identifier/i);
  assert.equal(called, false);
});
