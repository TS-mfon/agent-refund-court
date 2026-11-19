import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadMcpConfig } from '../src/mcp/config.js';
import { createAgentRuntime } from '../src/mcp/runtime.js';
import { createMcpServer } from '../src/mcp/server.js';
import { LocalStateStore } from '../src/workflow/local-store.js';
async function main() {
  const config=await loadMcpConfig();
  const runtime=createAgentRuntime({ ...config,store:new LocalStateStore(config.directory) });
  const handle=await serveStdio(()=>createMcpServer(runtime));
  let closing=false;
  const shutdown=async()=>{if(closing)return;closing=true;await handle.close();};
  process.once('SIGINT',()=>void shutdown().catch(()=>{process.exitCode=1;}));
  process.once('SIGTERM',()=>void shutdown().catch(()=>{process.exitCode=1;}));
}
void main().catch(()=>{console.error(JSON.stringify({error:'MCP_STARTUP_FAILED',hint:'Configure a private local buyer wallet and spending mandate.'}));process.exitCode=1;});
