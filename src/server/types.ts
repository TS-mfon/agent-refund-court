import type { AppConfig } from '../config.js';
import type { StateStore } from '../storage/index.js';
import type { PaymentService } from '../payments/index.js';
import type { createGeminiModel } from '../agent/gemini.js';
import type { Address } from 'viem';
import type { CaseManifest } from '../domain/schema.js';

export type Principal = { role: 'operator' } | { role: 'buyer'; address: Address };

export type ServerOptions = {
  config: AppConfig;
  store: StateStore;
  payments?: Pick<PaymentService, 'process' | 'recover' | 'getOrder'>;
  model?: Pick<ReturnType<typeof createGeminiModel>, 'seller' | 'defense'>;
  processCase?: (caseId: string) => Promise<CaseManifest>;
  now?: () => number;
};
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, readonly userMessage: string, readonly retryAfterSeconds?: number) {
    super(code); this.name = 'ApiError';
  }
}
