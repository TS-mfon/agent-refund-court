import type { AppConfig } from '../config.js';
import type { StateStore } from '../storage/index.js';
import type { PaymentService } from '../payments/index.js';
import type { createGeminiModel } from '../agent/gemini.js';
import type { CaseManifest } from '../domain/schema.js';

export type ServerOptions = {
  config: AppConfig;
  store: StateStore;
  payments?: Pick<PaymentService, 'process' | 'recover' | 'getOrder'>;
  model?: Pick<ReturnType<typeof createGeminiModel>, 'seller' | 'defense'>;
  processCase?: (caseId: string) => Promise<CaseManifest>;
  now?: () => number;
};
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, readonly userMessage: string) {
    super(code); this.name = 'ApiError';
  }
}
