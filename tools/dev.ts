import express from 'express';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { request as proxyRequest } from 'node:http';

if (process.argv.includes('--web')) {
  const app = express();
  app.use('/api', (req, res) => {
    const upstream = proxyRequest({ host: '127.0.0.1', port: 3001, path: req.originalUrl, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { res.status(502).json({ error: { message: 'The local backend could not be reached.' } }); });
    req.pipe(upstream);
  });
  app.get('/assets/:name', async (req, res) => {
    if (!['main.js', 'main.css'].includes(req.params.name)) { res.sendStatus(404); return; }
    const bundle = await build({ entryPoints: ['web/main.tsx'], bundle: true, outdir: 'dist/assets', write: false, format: 'esm', jsx: 'automatic', target: 'es2022', define: { 'process.env.NODE_ENV': '"development"' } });
    const file = bundle.outputFiles.find(item => item.path.endsWith('/' + req.params.name));
    if (!file) { res.sendStatus(404); return; }
    res.type(req.params.name.endsWith('.css') ? 'text/css' : 'text/javascript').send(Buffer.from(file.contents));
  });
  app.use(express.static('public', { fallthrough: true }));
  app.use(async (_req, res) => res.type('html').send(await readFile('index.html', 'utf8')));
  app.listen(5173, '127.0.0.1', () => console.log('Case viewer http://127.0.0.1:5173'));
} else {
  const { createRuntimeApp } = await import('../src/runtime.js');
  const app = await createRuntimeApp();
  app.listen(3001, '127.0.0.1', () => console.log('Case API http://127.0.0.1:3001'));
}
