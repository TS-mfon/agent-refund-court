import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createRuntimeApp } from '../src/runtime.js';

export const maxDuration = 60;
let runtime: Promise<Express> | undefined;
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    runtime ??= Promise.resolve(createRuntimeApp());
    const app = await runtime;
    app(req, res);
  } catch {
    runtime = undefined;
    console.error(JSON.stringify({ event: 'runtime_initialization_failed' }));
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' } }));
  }
}
