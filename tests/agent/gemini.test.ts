import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const mockApiKey=randomUUID();
import { createGeminiModel, ModelError } from '../../src/agent/gemini.js';
import { createAgreement, hashContent } from '../../src/domain/identity.js';
import { SAMPLE_BRIEF, type BuyerDecision } from '../../src/domain/schema.js';

const address = '0x' + '11'.repeat(20);
const agreement = createAgreement({
  buyer: address, seller: address, receiptSigner: address,
  origin: 'https://demo.example', brief: SAMPLE_BRIEF, now: 1700000000,
});
const text = 'Build awareness and stay consistent.';
const delivery = { text, hash: hashContent(text), committedAt: 1700000000 };
const claim: BuyerDecision = {
  action: 'dispute', materialFailure: true, criterionIds: ['actionability'],
  reason: 'No concrete work.', quotes: ['Build awareness'],
};
type RequestBody = { generationConfig: Record<string, unknown> };
function model(
  answer: string,
  inspect?: (body: RequestBody, url: string, init: RequestInit | undefined) => void,
  finishReason: string | undefined = 'STOP',
) {
  return createGeminiModel({
    apiKey: mockApiKey,
    fetcher: async (url, init) => {
      inspect?.(JSON.parse(String(init?.body)) as RequestBody, String(url), init);
      return Response.json({ candidates: [{
        finishReason, content: { parts: [{ text: answer }] },
      }] });
    },
  });
}

test('seller uses verified 3.1 Flash-Lite, one candidate, small output and minimal thinking', async () => {
  let config: Record<string, unknown> = {};
  const m = model('A practical launch plan.', (body, url, init) => {
    config = body.generationConfig;
    assert.match(url, /models\/gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(new URL(url).search, '');
    assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], mockApiKey);
  });
  assert.equal(await m.seller(agreement), 'A practical launch plan.');
  assert.equal(config.maxOutputTokens, 512);
  assert.equal(config.candidateCount, 1);
  assert.deepEqual(config.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(config.responseMimeType, 'text/plain');
});

test('buyer requests native bounded JSON schema and a 384-token response', async () => {
  const m = model(JSON.stringify(claim), body => {
    const config = body.generationConfig;
    assert.equal(config.maxOutputTokens, 384);
    assert.equal(config.responseMimeType, 'application/json');
    const schema = config.responseSchema as {
      required: string[];
      properties: { action: { enum: string[] }; criterionIds: { maxItems: number }; quotes: { maxItems: number } };
    };
    assert.deepEqual(schema.required, ['action', 'materialFailure', 'criterionIds', 'reason', 'quotes']);
    assert.deepEqual(schema.properties.action.enum, ['accept', 'dispute']);
    assert.equal(schema.properties.criterionIds.maxItems, 3);
    assert.equal(schema.properties.quotes.maxItems, 3);
  });
  assert.deepEqual(await m.buyer(agreement, delivery), claim);
});

test('accept is a validated independent decision', async () => {
  const acceptance = {
    action: 'accept', materialFailure: false, criterionIds: [],
    reason: 'The three actions fulfill the brief.', quotes: [],
  };
  assert.deepEqual(await model(JSON.stringify(acceptance)).buyer(agreement, delivery), acceptance);
});

test('buyer rejects money instructions, fabricated quotations and contradictory acceptance', async () => {
  await assert.rejects(model('{"action":"refund"}').buyer(agreement, delivery), /MODEL_INVALID_DECISION/);
  await assert.rejects(model(JSON.stringify({ ...claim, quotes: ['not present'] })).buyer(agreement, delivery), /MODEL_INVALID_QUOTE/);
  await assert.rejects(model(JSON.stringify({ ...claim, action: 'accept' })).buyer(agreement, delivery), /MODEL_INVALID_DECISION/);
});

test('buyer rejects malformed JSON and invalid criterion failures', async () => {
  await assert.rejects(model('not JSON').buyer(agreement, delivery), /MODEL_INVALID_JSON/);
  await assert.rejects(model(JSON.stringify({ ...claim, materialFailure: false })).buyer(agreement, delivery), /MODEL_INVALID_DECISION/);
  await assert.rejects(model(JSON.stringify({ ...claim, criterionIds: [] })).buyer(agreement, delivery), /MODEL_INVALID_DECISION/);
});

test('truncated and incomplete responses cannot become delivered work or decisions', async () => {
  await assert.rejects(model('A partial plan', undefined, 'MAX_TOKENS').seller(agreement), /MODEL_TRUNCATED_RESPONSE/);
  await assert.rejects(model(JSON.stringify(claim), undefined, 'MAX_TOKENS').buyer(agreement, delivery), /MODEL_TRUNCATED_RESPONSE/);
  const missing = createGeminiModel({
    apiKey: 'test',
    fetcher: async () => Response.json({ candidates: [{ content: { parts: [{ text: 'A plan' }] } }] }),
  });
  await assert.rejects(missing.seller(agreement), /MODEL_INCOMPLETE_RESPONSE/);
});

test('blocked responses, even with text, cannot pass as work', async () => {
  await assert.rejects(model('Partial content', undefined, 'SAFETY').seller(agreement), /MODEL_RESPONSE_BLOCKED/);
  const blocked = createGeminiModel({
    apiKey: 'test', fetcher: async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
  });
  await assert.rejects(blocked.seller(agreement), /MODEL_RESPONSE_BLOCKED/);
});

test('provider HTTP errors are classified without exposing upstream message or credential', async () => {
  for (const status of [400, 401, 429, 500, 503]) {
    let requests = 0;
    const bad = createGeminiModel({ apiKey: 'private-key', fetcher: async () => {
      requests += 1;
      return Response.json({ error: { message: 'private-key provider details' } }, { status });
    } });
    await assert.rejects(bad.seller(agreement), error =>
      error instanceof ModelError && error.code === 'MODEL_HTTP_' + status && !error.message.includes('private-key'));
    assert.equal(requests, 1);
  }
});

test('transport failures are redacted and do not retry', async () => {
  let requests = 0;
  const bad = createGeminiModel({ apiKey: 'private-key', fetcher: async () => {
    requests += 1;
    throw new Error('Network failed with private-key');
  } });
  await assert.rejects(bad.seller(agreement), error =>
    error instanceof ModelError && error.code === 'MODEL_UNAVAILABLE' && !error.message.includes('private-key'));
  assert.equal(requests, 1);
});

test('aborted inference reports a timeout without fabricating output', async () => {
  const bad = createGeminiModel({
    apiKey: 'test', timeoutMs: 1,
    fetcher: async () => { throw new DOMException('private provider detail', 'TimeoutError'); },
  });
  await assert.rejects(bad.seller(agreement), /MODEL_TIMEOUT/);
});

test('empty, malformed and oversized provider responses fail explicitly', async () => {
  await assert.rejects(model('').seller(agreement), /MODEL_EMPTY_RESPONSE/);
  const invalid = createGeminiModel({ apiKey: 'test', fetcher: async () => new Response('not JSON') });
  await assert.rejects(invalid.seller(agreement), /MODEL_INVALID_RESPONSE/);
  const oversized = createGeminiModel({ apiKey: 'test', fetcher: async () => new Response('x'.repeat(65537)) });
  await assert.rejects(oversized.seller(agreement), /MODEL_INVALID_RESPONSE/);
});

test('thinking parts are excluded from the purchased answer', async () => {
  const m = createGeminiModel({
    apiKey: 'test', fetcher: async () => Response.json({ candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ thought: true, text: 'private reasoning' }, { text: 'A practical plan.' }] },
    }] }),
  });
  assert.equal(await m.seller(agreement), 'A practical plan.');
});

test('invalid model config and inputs never contact the provider', async () => {
  for (const options of [
    { apiKey: '' }, { apiKey: ' ' }, { apiKey: 'test', model: 'gemini-2.5-pro' },
    { apiKey: 'test', model: 'gemini-3.5-pro' }, { apiKey: 'test', timeoutMs: 0 },
    { apiKey: 'test', timeoutMs: Number.NaN },
  ]) assert.throws(() => createGeminiModel(options), /INVALID_MODEL_CONFIG/);
  let requests = 0;
  const m = createGeminiModel({ apiKey: 'test', fetcher: async () => {
    requests += 1;
    throw new Error('Should not run');
  } });
  await assert.rejects(m.seller({ ...agreement, brief: 'x'.repeat(1201) }), /MODEL_INVALID_INPUT/);
  await assert.rejects(m.buyer(agreement, { ...delivery, text: 'x'.repeat(3001) }), /MODEL_INVALID_INPUT/);
  assert.equal(requests, 0);
});

test('seller defense stays within a 128-token budget', async () => {
  let tokens: unknown;
  const m = model('The answer addresses promotion but lacks practical detail.', body => {
    tokens = body.generationConfig.maxOutputTokens;
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  });
  assert.equal(await m.defense(agreement, delivery, claim), 'The answer addresses promotion but lacks practical detail.');
  assert.equal(tokens, 128);
});

test('documented Gemini 3.x Flash-Lite variants use minimal thinking with the same small budgets', async () => {
  for (const modelId of ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']) {
    const m = createGeminiModel({ apiKey: 'test', model: modelId, fetcher: async (url, init) => {
      assert.equal(String(url).split('/').at(-1), modelId + ':generateContent');
      const body = JSON.parse(String(init?.body)) as RequestBody;
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
      assert.equal(body.generationConfig.maxOutputTokens, 512);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'A practical plan.' }] } }] });
    } });
    assert.equal(await m.seller(agreement), 'A practical plan.');
  }
});

test('Gemini 2.5 Flash-Lite retains its documented thinking-off configuration', async () => {
  const m = createGeminiModel({ apiKey: 'test', model: 'gemini-2.5-flash-lite', fetcher: async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(body.generationConfig.maxOutputTokens, 512);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'A plan.' }] } }] });
  } });
  assert.equal(await m.seller(agreement), 'A plan.');
});

test('custom seller work follows its exact brief without imposing a launch campaign', async () => {
  const custom = { ...agreement, serviceId: 'agent-work-v1' as const, rubricId: 'agent-work-v1' as const,
    brief: 'Compare SQLite and Postgres for a solo-built scheduling app.' };
  const m = model('SQLite keeps deployment simple; Postgres supports concurrent writes.', (_body, _url, init) => {
    const request = JSON.parse(String(init?.body)) as { contents: { parts: { text: string }[] }[]; generationConfig: Record<string, unknown> };
    const prompt = request.contents[0].parts[0].text;
    assert.ok(prompt.includes(custom.brief));
    assert.ok(!prompt.includes('first-week launch plan'));
    assert.ok(!prompt.includes('three practical actions'));
    assert.equal(request.generationConfig.maxOutputTokens, 512);
  });
  assert.match(await m.seller(custom), /SQLite/);
});

test('legacy seller task still requests the first-week launch plan', async () => {
  const m = model('A practical plan.', (_body, _url, init) => {
    const request = JSON.parse(String(init?.body)) as { contents: { parts: { text: string }[] }[] };
    assert.ok(request.contents[0].parts[0].text.includes('first-week launch plan'));
  });
  assert.equal(await m.seller(agreement), 'A practical plan.');
});
