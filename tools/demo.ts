import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { privateKeyToAccount } from 'viem/accounts';
import { AddressSchema, CaseManifestSchema, HashSchema, bounded } from '../src/domain/schema.js';
import { createGeminiModel } from '../src/agent/gemini.js';
import { createBuyerWorkflow } from '../src/workflow/buyer.js';
import { LocalStateStore } from '../src/workflow/local-store.js';
import { cliArguments, demoOrigin, sleep, DemoHttpError, responseJSON } from '../src/workflow/http.js';
import { createWalletSession } from '../src/mcp/auth.js';
import { loadMcpConfig } from '../src/mcp/config.js';
const privateDirectory = join(homedir(), '.config', 'agent-refund-court');
async function main() {
  const args = cliArguments(process.argv.slice(2));
  const origin = demoOrigin(args.origin ?? process.env.SERVICE_ORIGIN ?? '');
  const token = process.env.DEMO_ACCESS_TOKEN;
  if(args.brief && args['brief-file'])throw new DemoHttpError('CONFIGURE_ONE_BRIEF_SOURCE');
  const brief=args['brief-file']?bounded(1200).parse(await readFile(args['brief-file'],'utf8')):args.brief?bounded(1200).parse(args.brief):undefined;
  const serviceId=z.enum(['launch-plan-v1','agent-work-v1']).parse(args['service-id']??(brief?'agent-work-v1':'launch-plan-v1'));
  const wallets = z.object({ buyer: z.object({ privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/), address: AddressSchema }) })
    .parse(JSON.parse(await readFile(join(privateDirectory, 'wallets.json'), 'utf8')));
  const buyer = process.env.ARC_MANDATE_FILE ? (await loadMcpConfig()).signer : privateKeyToAccount(wallets.buyer.privateKey as `0x${string}`);
  if (!process.env.ARC_MANDATE_FILE && buyer.address !== wallets.buyer.address) throw new Error('BUYER_WALLET_INTEGRITY_FAILED');
  const settings = process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY, model: process.env.MODEL_ID } :
    JSON.parse(await readFile(join(privateDirectory, 'model.json'), 'utf8')) as { apiKey: string; model: string };
  const model = createGeminiModel({ ...settings, model: process.env.MODEL_ID ?? settings.model });
  const scenario = z.enum(['bad', 'good', 'live']).parse(args.scenario ?? (brief ? 'live' : 'bad'));
  const store = new LocalStateStore(join(privateDirectory, 'buyer-state'));
  const session=createWalletSession({origin,signer:buyer,accessToken:token});
  const buyerWorkflow = createBuyerWorkflow({ origin, token, request:session.request, signer: buyer, store, model,
    expectedSeller: process.env.EXPECTED_SELLER, report: value => console.log(JSON.stringify(value)) });
  let c = await buyerWorkflow({ scenario, brief, serviceId, resume: args.resume ? HashSchema.parse(args.resume) : undefined });
  if (c.buyerClaim?.action !== 'dispute') {
    console.log(JSON.stringify({ caseId: c.id, status: c.status, viewer: origin + '/?case=' + c.id, buyerAccepted: true })); return;
  }
  const steps = Number(args.steps ?? '120'); if (!Number.isInteger(steps) || steps < 0 || steps > 180) throw new Error('INVALID_STEP_LIMIT');
  const schema = z.object({ case: CaseManifestSchema }); let status = c.status;
  for (let step = 0; step < steps; step += 1) {
    try { c = schema.parse(await responseJSON(await session.request('/api/v1/cases/' + c.id + '/process',{method:'POST',body:'{}'}))).case; }
    catch (error) {
      if (!(error instanceof DemoHttpError) || !['HTTP_409', 'HTTP_429', 'HTTP_503'].includes(error.code)) throw error;
      console.log(JSON.stringify({ caseId: c.id, status: c.status, retry: error.code, serverErrorCode: error.serverErrorCode })); await sleep(8000); continue;
    }
    if (c.status !== status) { status = c.status; console.log(JSON.stringify({ caseId: c.id, status, decision: c.court?.result?.decision ?? null })); }
    if (c.status === 'refunded' || c.status === 'unresolved' || c.court?.verified && c.court.result?.decision === 'NO_REFUND') break;
    await sleep(8000);
  }
  console.log(JSON.stringify({ caseId: c.id, orderId: c.agreement.orderId, status: c.status, mode: c.mode,
    decision: c.court?.result?.decision ?? null, payment: c.payment?.transactionHash ?? null,
    court: c.court?.transactionHash ?? null, refund: c.refund?.transactionHash ?? null,
    verified: c.status === 'refunded' && c.refund?.verified === true, viewer: origin + '/?case=' + c.id }));
}
main().catch(error => {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'DEMO_FAILED';
  console.error(JSON.stringify({ error: code, serverErrorCode: error instanceof DemoHttpError ? error.serverErrorCode : undefined, recovery: 'Resume the original order using --resume; never create a replacement payment after an uncertain outcome.' }));
  process.exitCode = 1;
});
