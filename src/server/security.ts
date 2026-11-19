import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { PaymentError } from '../payments/index.js';
import { StorageConflict } from '../storage/index.js';
import { WalletAuthentication } from './auth.js';
import { ApiError, type Principal, type ServerOptions } from './types.js';

const digest = (value: string) => createHash('sha256').update(value).digest();
export function allowedOrigin(options: ServerOptions): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== options.config.origin)
      return next(new ApiError('ORIGIN_REJECTED', 403, 'This request origin is not allowed.'));
    next();
  };
}
export function authenticated(options: ServerOptions): RequestHandler {
  const walletAuth = new WalletAuthentication(options);
  return async (req, res, next) => {
    const expected = options.config.accessToken, header = req.get('authorization') ?? '';
    if (!header.startsWith('Bearer ') || header.length > 1024)
      throw new ApiError('UNAUTHORIZED', 401, 'A valid wallet session or operator access token is required.');
    const origin = req.get('origin');
    if (origin && origin !== options.config.origin) throw new ApiError('ORIGIN_REJECTED', 403, 'This request origin is not allowed.');
    const accessToken = header.slice(7);
    const principal: Principal = expected && timingSafeEqual(digest(accessToken), digest(expected)) ?
      { role: 'operator' } : await walletAuth.authenticate(accessToken);
    res.locals.principal = principal;
    next();
  };
}
export function authorizeBuyer(principal: Principal | undefined, address: string, code = 'ORDER_NOT_FOUND') {
  if (principal?.role === 'buyer' && principal.address.toLowerCase() !== address.toLowerCase())
    throw new ApiError(code, 404, 'This resource could not be found.');
}
/** Per-instance public limit; authenticated writes also use the shared durable counter. */
export function requestLimits(options: ServerOptions): RequestHandler {
  let windows = new Map<string, { start: number; count: number }>();
  return async (req, res, next) => {
    const now = (options.now ?? Date.now)();
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const old = windows.get(key);
    const counter = !old || now - old.start >= 60000 ? { start: now, count: 1 } : { ...old, count: old.count + 1 };
    const entries = [...windows.entries()].filter(([, value]) => now - value.start < 60000);
    windows = new Map([...entries.slice(-2000), [key, counter]]);
    if (counter.count > 300) {
      res.set('Retry-After', '60');
      return next(new ApiError('RATE_LIMITED', 429, 'Too many requests. Retry in a minute.'));
    }
    next();
  };
}
export function durableWriteLimit(options: ServerOptions): RequestHandler {
  return async (req, res, next) => {
    if (!options.config.canWrite) return next(new ApiError('SERVICE_NOT_CONFIGURED', 503, 'Live purchases are not configured.'));
    const minute = Math.floor((options.now ?? Date.now)() / 60000);
    const key = 'api-limits/' + minute + '.json';
    try {
      const current = await options.store.get<{ count: number }>(key);
      if ((current?.value.count ?? 0) >= 120) {
        res.set('Retry-After', '60');
        return next(new ApiError('RATE_LIMITED', 429, 'The service action limit was reached. Retry in a minute.'));
      }
      if (current) await options.store.compareAndSwap(key, { count: current.value.count + 1 }, current.etag);
      else await options.store.create(key, { count: 1 });
      next();
    } catch (error) {
      next(error instanceof StorageConflict ? new ApiError('RETRY_REQUEST', 409, 'Another request is in progress. Retry the same request.') : error);
    }
  };
}
export const errorResponse: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof ApiError) {
    if (error.status === 401) res.set('WWW-Authenticate', 'Bearer');
    if (error.status === 429) res.set('Retry-After', String(error.retryAfterSeconds ?? 60));
    res.status(error.status).json({ success: false, error: { code: error.code, message: error.userMessage } });
    return;
  }
  if (error instanceof ZodError || error instanceof SyntaxError || error?.type === 'entity.too.large') {
    res.status(error?.type === 'entity.too.large' ? 413 : 400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'The request did not pass validation.' } });
    return;
  }
  if (error instanceof StorageConflict) {
    res.status(409).json({ success: false, error: { code: 'STATE_CONFLICT', message: 'Another request changed this case. Retry the same request.' } });
    return;
  }
  if (error instanceof PaymentError) {
    const status = error.code === 'INVALID_SIGNATURE' ? 403 : error.code === 'PAYMENT_CONTEXT_CONFLICT' ? 409 : 400;
    res.status(status).json({ success: false, error: { code: error.code, message: 'The payment could not be verified. Retry with the original signed checkout.' } });
    return;
  }
  // SDK exceptions can contain credential-bearing headers, so never serialize them.
  console.error(JSON.stringify({ event: 'api_error', code: 'SERVICE_UNAVAILABLE' }));
  res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Your saved order remains recoverable.' } });
};
