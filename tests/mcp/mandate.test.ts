import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStateStore } from '../../src/storage/index.js';
import { createBudget, MandateSchema, allowedOrigin } from '../../src/mcp/mandate.js';
const mandate = { allowedOrigins: ['https://seller.example'], maxPerPurchaseBaseUnits: '10000', dailyBudgetBaseUnits: '20000' };
test('standing mandate validates origins and positive bounded USDC amounts', () => {
  assert.equal(allowedOrigin(MandateSchema.parse(mandate), 'https://seller.example/'), 'https://seller.example');
  assert.throws(() => allowedOrigin(MandateSchema.parse(mandate), 'https://other.example'), /ORIGIN_NOT_AUTHORIZED/);
  for (const value of [{ ...mandate, dailyBudgetBaseUnits: '0' }, { ...mandate, maxPerPurchaseBaseUnits: '2'.repeat(79) },
    { ...mandate, allowedOrigins: ['https://name:password@seller.example'] }, { ...mandate, maxPerPurchaseBaseUnits: '30000' }])
    assert.equal(MandateSchema.safeParse(value).success, false);
});
test('concurrent reservations cannot exceed the daily budget and retries do not spend again', async () => {
  const store = new MemoryStateStore(), budget = createBudget(store, MandateSchema.parse(mandate), () => 1800000000000);
  const results = await Promise.allSettled(['a', 'b', 'c', 'd'].map(id => budget.reserve(id, '10000')));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 2);
  const admitted = results.findIndex(value => value.status === 'fulfilled');
  await budget.reserve(['a', 'b', 'c', 'd'][admitted], '10000');
  await assert.rejects(budget.reserve('oversize', '10001'), /PER_PURCHASE_BUDGET_EXCEEDED/);
  const first = await store.get<{ reservations: Record<string, {amount:string,date:string}> }>('mandate/budget.json');
  assert.equal(Object.values(first!.value.reservations).reduce((sum, amount) => sum + BigInt(amount.amount), 0n), 20000n);
});
test('unknown authorization outcomes retain their reservation across restarts and amount changes', async () => {
  const store = new MemoryStateStore(), clock = () => 1800000000000;
  await createBudget(store, MandateSchema.parse(mandate), clock).reserve('uncertain', '10000');
  const resumed = createBudget(store, MandateSchema.parse(mandate), clock);
  await resumed.reserve('uncertain', '10000');
  await assert.rejects(resumed.reserve('uncertain', '9000'), /RESERVATION_CONFLICT/);
  await resumed.reserve('second', '10000');
  await assert.rejects(resumed.reserve('third', '1'), /DAILY_BUDGET_EXCEEDED/);
});

test('resuming yesterday’s unknown payment neither releases its reservation nor reserves again today', async () => {
  const store=new MemoryStateStore(), parsed=MandateSchema.parse(mandate);
  await createBudget(store,parsed,()=>1800000000000).reserve('original','10000');
  const nextDay=createBudget(store,parsed,()=>1800086400000);
  await nextDay.reserve('today-a','10000'); await nextDay.reserve('today-b','10000');
  await nextDay.reserve('original','10000');
  await assert.rejects(nextDay.reserve('today-c','1'),/DAILY_BUDGET_EXCEEDED/);
});
