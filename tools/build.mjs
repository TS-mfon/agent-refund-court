import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
await mkdir('dist/assets',{recursive:true});
await build({entryPoints:['web/main.tsx'],bundle:true,outfile:'dist/assets/main.js',format:'esm',jsx:'automatic',target:'es2022',minify:true,sourcemap:false,define:{'process.env.NODE_ENV':'"production"'}});
await writeFile('dist/index.html',await readFile('index.html'));
try{await access('public');await cp('public','dist',{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
console.log('Frontend build passed');
