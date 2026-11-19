import { readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=process.cwd();
const targets=process.argv.slice(2).length?process.argv.slice(2):['tests'];
function collect(path){
 const full=resolve(root,path); if(!relative(root,full).startsWith('tests'))throw new Error('Tests must stay in tests/');
 if(statSync(full).isFile())return full.endsWith('.test.ts')?[full]:[];
 return readdirSync(full).sort().flatMap(name=>name==='e2e'?[]:collect(relative(root,resolve(full,name))));
}
const files=[...new Set(targets.flatMap(collect))];
if(!files.length)throw new Error('No test files found');
const run=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=2',...files],{stdio:'inherit'});
if(run.status!==0)process.exit(run.status??1);
console.log('Test Files '+files.length+' passed');
