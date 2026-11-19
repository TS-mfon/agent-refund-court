import { z } from 'zod';
import { parseCase, parseCases } from './model.js';

export type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
const ServiceSchema = z.object({
	id: z.enum(['launch-plan-v1', 'agent-work-v1']),
	priceBaseUnits: z.string().regex(/^[0-9]+$/),
	symbol: z.literal('USDC'),
	network: z.string(),
	courtNetwork: z.string(),
	repository: z.string().url(),
	capabilities: z.object({ purchase: z.boolean(), generation: z.boolean() }),
});
export type Service = z.infer<typeof ServiceSchema>;
async function read(
	path: string,
	signal?: AbortSignal,
	fetcher: Fetcher = fetch,
): Promise<unknown> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) controller.abort();
	const timeout = setTimeout(() => controller.abort(), 10000);
	try {
		const response = await fetcher(path, {
			signal: controller.signal,
			cache: 'no-store',
			headers: { Accept: 'application/json' },
		});
		if (!response.ok)
			throw new Error(
				'The case service returned HTTP ' +
					response.status +
					'. Retry to check again.',
			);
		try {
			return await response.json();
		} catch {
			throw new Error(
				'The case service response could not be read. Retry to check again.',
			);
		}
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener('abort', abort);
	}
}
export async function fetchCases(signal?: AbortSignal, fetcher?: Fetcher) {
	return parseCases(await read('/api/v1/cases', signal, fetcher));
}
export async function fetchCase(
	id: string,
	signal?: AbortSignal,
	fetcher?: Fetcher,
) {
	if (!/^0x[0-9a-fA-F]{64}$/.test(id))
		throw new Error('Invalid case identifier.');
	const c = parseCase(await read('/api/v1/cases/' + id, signal, fetcher));
	if (c.id.toLowerCase() !== id.toLowerCase())
		throw new Error('Case identifier did not match the response.');
	return c;
}
export async function fetchService(signal?: AbortSignal): Promise<Service> {
	const result = z
		.object({ service: ServiceSchema })
		.safeParse(await read('/api/v1/service', signal));
	if (!result.success) throw new Error('Service details unavailable.');
	return result.data.service;
}
export async function fetchEvidence(
	id: string,
	signal?: AbortSignal,
): Promise<unknown> {
	if (!/^0x[0-9a-fA-F]{64}$/.test(id))
		throw new Error('Invalid case identifier.');
	const result = z
		.object({ evidence: z.unknown() })
		.safeParse(await read('/api/v1/cases/' + id + '/evidence', signal));
	if (
		!result.success ||
		result.data.evidence === undefined ||
		result.data.evidence === null
	)
		throw new Error('Original evidence is not published yet.');
	return result.data.evidence;
}
