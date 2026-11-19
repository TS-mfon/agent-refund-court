import { z } from 'zod';
import { DemoHttpError, demoOrigin } from '../workflow/http.js';
import { StorageConflict, type StateStore } from '../storage/index.js';
const amount=z.string().regex(/^[1-9][0-9]{0,77}$/).refine(value=>BigInt(value)<2n**256n);
const origin=z.string().min(1).max(300).refine(value=>{try{demoOrigin(value);return true;}catch{return false;}}).transform(demoOrigin);
export const MandateSchema=z.object({
  allowedOrigins:z.array(origin).min(1).max(20).refine(values=>new Set(values).size===values.length),
  maxPerPurchaseBaseUnits:amount,dailyBudgetBaseUnits:amount,
}).strict().refine(value=>BigInt(value.maxPerPurchaseBaseUnits)<=BigInt(value.dailyBudgetBaseUnits));
export type Mandate=z.infer<typeof MandateSchema>;
export function allowedOrigin(mandate:Mandate,input:string) {
  const value=demoOrigin(input);
  if(!mandate.allowedOrigins.includes(value))throw new DemoHttpError('ORIGIN_NOT_AUTHORIZED');
  return value;
}
const LedgerSchema=z.object({
  reservations:z.record(z.string().min(1).max(100),z.object({amount,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict()),
}).strict();
/** A single CAS ledger serializes budgets across merchants, processes and UTC date changes. */
export function createBudget(store:StateStore,mandate:Mandate,now:()=>number=Date.now) {
  return {async reserve(reservationId:string,inputAmount:string) {
    const cost=amount.parse(inputAmount);
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(reservationId))throw new DemoHttpError('INVALID_RESERVATION');
    if(BigInt(cost)>BigInt(mandate.maxPerPurchaseBaseUnits))throw new DemoHttpError('PER_PURCHASE_BUDGET_EXCEEDED');
    const key='mandate/budget.json',date=new Date(now()).toISOString().slice(0,10);
    for(let attempt=0;attempt<30;attempt+=1) {
      const row=await store.get(key),ledger=LedgerSchema.parse(row?.value??{reservations:{}});
      const previous=ledger.reservations[reservationId];
      if(previous){if(previous.amount!==cost)throw new DemoHttpError('RESERVATION_CONFLICT');return;}
      const spent=Object.values(ledger.reservations).filter(value=>value.date===date).reduce((total,value)=>total+BigInt(value.amount),0n);
      if(spent+BigInt(cost)>BigInt(mandate.dailyBudgetBaseUnits))throw new DemoHttpError('DAILY_BUDGET_EXCEEDED');
      const next={reservations:{...ledger.reservations,[reservationId]:{amount:cost,date}}};
      try {
        if(row)await store.compareAndSwap(key,next,row.etag);else await store.create(key,next);
        return;
      }catch(error){if(!(error instanceof StorageConflict))throw error;}
    }
    throw new DemoHttpError('BUDGET_BUSY');
  }};
}
