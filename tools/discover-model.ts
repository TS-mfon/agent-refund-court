import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
const CredentialsSchema = z.object({ apiKey: z.string().min(1).max(512) });
const ModelSchema = z.object({
  name: z.string().max(200),
  supportedGenerationMethods: z.array(z.string().max(100)).optional(),
  inputTokenLimit: z.number().int().optional(),
  outputTokenLimit: z.number().int().optional(),
});
async function main(): Promise<void> {
  const credential = CredentialsSchema.parse(JSON.parse(await readFile(join(homedir(), '.config', 'agent-refund-court', 'model.json'), 'utf8')));
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': credential.apiKey },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('MODEL_HTTP_' + response.status);
  const body = z.object({ models: z.array(ModelSchema).max(1000) }).parse(await response.json());
  const models = body.models.filter(model => model.name.includes('flash-lite') &&
    model.supportedGenerationMethods?.includes('generateContent'));
  console.log(JSON.stringify({ passed: models.length > 0, lightweightModels: models }, null, 2));
  if (!models.length) process.exitCode = 1;
}
main().catch(error => {
  const code = error instanceof Error && /^MODEL_HTTP_[0-9]{3}$/.test(error.message) ? error.message : 'MODEL_DISCOVERY_FAILED';
  console.error(JSON.stringify({ passed: false, code }));
  process.exitCode = 1;
});
