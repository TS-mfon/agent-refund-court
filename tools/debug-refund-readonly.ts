import { HashSchema, PaymentProofSchema } from '../src/domain/schema.js';
import { refundIdentity } from '../src/domain/identity.js';
import { createViemRefundChain } from '../src/workflow/refund-chain.js';
const caseId = HashSchema.parse(process.argv[2]);
function failureCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const item = current as { message?: unknown; cause?: unknown; status?: unknown };
    const message = typeof item.message === 'string' ? item.message : '';
    if (message.includes('REFUND_HISTORY_SCAN_LIMIT')) return 'REFUND_HISTORY_SCAN_LIMIT';
    if (item.status === 429 || /rate limit|too many requests/i.test(message)) return 'RPC_RATE_LIMIT';
    if (item.status === 403 || item.status === 401) return 'RPC_ACCESS_DENIED';
    if (/block range|range limit|limited to.*blocks|maximum.*blocks/i.test(message)) return 'RPC_HISTORY_RANGE_LIMIT';
    if (/timed out|timeout/i.test(message)) return 'RPC_TIMEOUT';
    current = item.cause;
  }
  return 'RPC_UNAVAILABLE';
}
async function main() {
  const response = await fetch('https://agent-refund-court.vercel.app/api/v1/cases/' + caseId,
    { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('PUBLIC_CASE_UNAVAILABLE');
  const body = await response.json() as { case?: { payment?: unknown } };
  const payment = PaymentProofSchema.parse(body.case?.payment);
  const chain = createViemRefundChain({ fromBlock: BigInt(payment.blockNumber) });
  const nonce = refundIdentity(caseId, payment.seller);
  let head = 0n;
  try {
    const observation = await chain.observation();
    head = observation.headBlockNumber;
    console.log(JSON.stringify({ stage: 'observation', status: 'ok', chainId: observation.chainId,
      paymentBlock: payment.blockNumber, headBlock: String(head), token: observation.token }));
  } catch (error) {
    console.log(JSON.stringify({ stage: 'observation', status: 'failed', code: failureCode(error) }));
    return;
  }
  for (const stage of ['authorizationState', 'authorizationHistory', 'balances'] as const) {
    try {
      if (stage === 'authorizationState') {
        const consumed = await chain.authorizationState(payment.seller, nonce, head);
        console.log(JSON.stringify({ stage, status: 'ok', consumed }));
      } else if (stage === 'authorizationHistory') {
        const logs = await chain.authorizationHistory(payment.seller, nonce, 0n, head);
        console.log(JSON.stringify({ stage, status: 'ok', count: logs.length }));
      } else {
        const balances = await chain.balances(payment.seller);
        console.log(JSON.stringify({ stage, status: 'ok', token: String(balances.token), gas: String(balances.gas) }));
      }
    } catch (error) {
      console.log(JSON.stringify({ stage, status: 'failed', code: failureCode(error) }));
    }
  }
}
main().catch(() => { console.error(JSON.stringify({ event: 'readonly_refund_probe_failed' })); process.exitCode = 1; });
