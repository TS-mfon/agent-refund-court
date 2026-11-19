import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const child=spawn(process.execPath,['--use-env-proxy','--import','tsx',join(root,'tools/mcp-server.ts')],{cwd:root,stdio:'inherit',env:process.env});
child.once('error',()=>{console.error(JSON.stringify({error:'MCP_STARTUP_FAILED'}));process.exitCode=1;});
child.once('close',(code)=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
