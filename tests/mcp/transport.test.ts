import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
test('official MCP client initializes stdio, lists constrained tools/resources and calls discover safely',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'arc-mcp-transport-')),key=generatePrivateKey(),buyer=privateKeyToAccount(key);
  const seller=privateKeyToAccount(generatePrivateKey()),receipt=privateKeyToAccount(generatePrivateKey());
  const http=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:{
    id:'agent-work-v1',services:['agent-work-v1','launch-plan-v1'],seller:seller.address,receiptSigner:receipt.address,
    priceBaseUnits:'10000',symbol:'USDC',network:'eip155:84532',capabilities:{purchase:true,generation:true},
  }}));});
  http.listen(0,'127.0.0.1');await once(http,'listening');
  const address=http.address();assert.ok(address&&typeof address==='object');
  const origin='http://127.0.0.1:'+address.port,mandate=join(directory,'mandate.json'),wallet=join(directory,'wallet.json');
  await writeFile(mandate,JSON.stringify({allowedOrigins:[origin],maxPerPurchaseBaseUnits:'10000',dailyBudgetBaseUnits:'20000'}),{mode:0o600});
  await writeFile(wallet,JSON.stringify({privateKey:key,address:buyer.address}),{mode:0o600});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('tools/arc-mcp.mjs')],stderr:'pipe',
    env:{PATH:process.env.PATH??'',ARC_MANDATE_FILE:mandate,ARC_BUYER_WALLET_FILE:wallet,ARC_STATE_DIRECTORY:join(directory,'state')}});
  let diagnostic='';transport.stderr?.on('data',chunk=>{diagnostic+=String(chunk);});
  const client=new Client({name:'arc-test-client',version:'1.0.0'});
  try{
    await client.connect(transport);
    const tools=await client.listTools();
    assert.deepEqual(tools.tools.map(tool=>tool.name).sort(),['discover_service','get_case','get_evidence','purchase_service','resume_purchase','submit_review']);
    const purchase=tools.tools.find(tool=>tool.name==='purchase_service')!;
    assert.deepEqual(purchase.inputSchema.required,['origin','serviceId','brief']);
    assert.equal(purchase.inputSchema.additionalProperties,false);
    assert.ok(tools.tools.every(tool=>tool.description&&tool.outputSchema));
    const called=await client.callTool({name:'discover_service',arguments:{origin}});
    const text=JSON.stringify(called);
    assert.ok(text.includes(seller.address));
    assert.ok(!text.includes(key));
    assert.ok(!text.includes(wallet));
    for(const block of called.content??[])if(block.type==='text')assert.ok(Buffer.byteLength(block.text)<=3000);
    const failedPurchase=await client.callTool({name:"purchase_service",arguments:{origin,serviceId:"agent-work-v1",brief:"Write a concise inventory reporting plan."}});
    assert.equal(failedPurchase.isError,true);
    const failedContent=failedPurchase.content?.find(block=>block.type==="text");
    assert.ok(failedContent?.type==="text");
    const failed=JSON.parse(failedContent.text);
    assert.equal(failed.ok,false);
    assert.equal(failed.error,"PURCHASE_OPERATION_FAILED");
    assert.match(failed.recovery.purchaseId,/^0x[0-9a-f]{64}$/);
    assert.equal(failed.recovery.orderId,null);
    assert.equal(failed.recovery.caseId,null);
    assert.deepEqual(failedPurchase.structuredContent,failed);
    const retry=await client.callTool({name:"resume_purchase",arguments:{purchaseId:failed.recovery.purchaseId}});
    assert.equal(retry.isError,true);
    assert.ok(JSON.stringify(retry).includes(failed.recovery.purchaseId));
    assert.ok(!JSON.stringify(retry).includes("QUOTE_OUTCOME_UNKNOWN_USE_ORIGINAL"));
    assert.ok(!JSON.stringify(failedPurchase).includes(key));
    const rejected=await client.callTool({name:'purchase_service',arguments:{origin,serviceId:'agent-work-v1',brief:'é'.repeat(601),privateKey:key}});
    assert.equal(rejected.isError,true);
    assert.ok(!JSON.stringify(rejected).includes(key));
    const denied=await client.callTool({name:'discover_service',arguments:{origin:'https://unauthorized.example'}});
    assert.equal(denied.isError,true);
    assert.ok(JSON.stringify(denied).includes('ORIGIN_NOT_AUTHORIZED'));
    const resources=await client.listResources();assert.ok(resources.resources.some(resource=>resource.uri==='arc://docs/workflow'));
    const doc=await client.readResource({uri:'arc://docs/workflow'});assert.ok(JSON.stringify(doc).includes('standing mandate'));
    assert.ok(!diagnostic.includes(key));
  }finally{
    await client.close();http.close();await once(http,'close');await rm(directory,{recursive:true,force:true});
  }
});
