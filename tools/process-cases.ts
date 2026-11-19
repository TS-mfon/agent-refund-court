import { z } from 'zod';
import { CaseManifestSchema, HashSchema } from '../src/domain/schema.js';
import { apiJSON, cliArguments, demoOrigin, sleep, DemoHttpError } from '../src/workflow/http.js';
async function main() {
  const args = cliArguments(process.argv.slice(2)), origin = demoOrigin(args.origin ?? process.env.SERVICE_ORIGIN ?? '');
  const token = process.env.DEMO_ACCESS_TOKEN; if (!token) throw new Error('DEMO_ACCESS_TOKEN_REQUIRED');
  const schema = z.object({ case: CaseManifestSchema });
  const cases = args.case ? [HashSchema.parse(args.case)] :
    (await apiJSON(origin, token, '/api/v1/cases', z.object({ cases: z.array(CaseManifestSchema) }))).cases
      .filter(c => c.mode !== 'simulation' && c.buyerClaim?.action === 'dispute' && c.status !== 'refunded' && c.status !== 'unresolved').map(c => c.id);
  const steps = Number(args.steps ?? '1'); if (!Number.isInteger(steps) || steps < 1 || steps > 180) throw new Error('INVALID_STEP_LIMIT');
  for (const id of cases) {
    for (let step = 0; step < steps; step += 1) {
      let c;
      try { c = (await apiJSON(origin, token, '/api/v1/cases/' + id + '/process', schema, {})).case; }
      catch (error) {
        if (!(error instanceof DemoHttpError) || !['HTTP_409', 'HTTP_429', 'HTTP_503'].includes(error.code)) throw error;
        console.log(JSON.stringify({ caseId: id, retry: error.code })); if (step + 1 < steps) await sleep(8000); continue;
      }
      console.log(JSON.stringify({ caseId: id, status: c.status, court: c.court?.status ?? null, refund: c.refund?.status ?? null }));
      if (c.status === 'refunded' || c.status === 'unresolved' || c.court?.verified && c.court.result?.decision === 'NO_REFUND') break;
      if (step + 1 < steps) await sleep(8000);
    }
  }
}
main().catch(error => { console.error(JSON.stringify({ error: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'WORKER_FAILED' })); process.exitCode = 1; });
