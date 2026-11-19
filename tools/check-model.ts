import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createGeminiModel, LIGHTWEIGHT_MODEL_ID, LIGHTWEIGHT_MODEL_IDS, ModelError } from '../src/agent/gemini.js';
import { createAgreement, hashContent } from '../src/domain/identity.js';
import { SAMPLE_BRIEF } from '../src/domain/schema.js';

const CredentialsSchema = z.object({
  apiKey: z.string().min(1).max(512),
  model: z.enum(LIGHTWEIGHT_MODEL_IDS).default(LIGHTWEIGHT_MODEL_ID),
});
const UsageSchema = z.object({
  promptTokenCount: z.number().int().nonnegative().optional(),
  candidatesTokenCount: z.number().int().nonnegative().optional(),
  thoughtsTokenCount: z.number().int().nonnegative().optional(),
  totalTokenCount: z.number().int().nonnegative().optional(),
});
type Usage = z.infer<typeof UsageSchema>;
let phase = 'configuration';
let usage: Usage | null = null;
const observedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.ok) {
    const body: unknown = await response.clone().json();
    const parsed = z.object({ usageMetadata: UsageSchema.optional() }).safeParse(body);
    usage = parsed.success ? parsed.data.usageMetadata ?? null : null;
  }
  return response;
};
async function main(): Promise<void> {
  const file = join(homedir(), '.config', 'agent-refund-court', 'model.json');
  const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--model')) throw new ModelError('INVALID_MODEL_CONFIG');
  const credentials = CredentialsSchema.parse({ ...stored, model: args[1] ?? process.env.MODEL_ID ?? stored.model });
  const model = createGeminiModel({ ...credentials, fetcher: observedFetch });
  const address = '0x' + '11'.repeat(20);
  const agreement = createAgreement({
    buyer: address, seller: address, receiptSigner: address,
    origin: 'https://demo.example', brief: SAMPLE_BRIEF, now: Math.floor(Date.now() / 1000),
  });

  phase = 'seller';
  const sellerStart = performance.now();
  const text = await model.seller(agreement);
  console.log(JSON.stringify({
    role: phase, model: credentials.model, passed: true,
    elapsedMs: Math.round(performance.now() - sellerStart),
    outputBytes: Buffer.byteLength(text), usage,
  }));

  phase = 'buyer';
  usage = null;
  const buyerStart = performance.now();
  const decision = await model.buyer(agreement, {
    text, hash: hashContent(text), committedAt: Math.floor(Date.now() / 1000),
  });
  console.log(JSON.stringify({
    role: phase, model: credentials.model, passed: true,
    elapsedMs: Math.round(performance.now() - buyerStart),
    action: decision.action, usage,
  }));
  if (decision.action !== 'accept') throw new ModelError('MODEL_SANITY_BUYER_DISPUTED');
  console.log('Lightweight seller and buyer live checks passed');
}
main().catch(error => {
  console.error(JSON.stringify({
    phase, passed: false,
    code: error instanceof ModelError ? error.code : 'MODEL_CHECK_FAILED',
  }));
  process.exitCode = 1;
});
