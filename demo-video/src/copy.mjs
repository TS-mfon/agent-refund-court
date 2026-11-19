export const shortHash=value=>value.slice(0,12)+'…'+value.slice(-10);
const excerpt=(value,limit)=>value.length>limit?value.slice(0,limit)+'…':value;
export function sceneText(c){
 return {quote:excerpt(c.buyerClaim.quotes[0]??c.delivery.text,160),
  answer:excerpt(c.delivery.text,280),claim:excerpt(c.buyerClaim.reason,190),
  reasoning:excerpt(c.court.result.reasoning,220)};
}
