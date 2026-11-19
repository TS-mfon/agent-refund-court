import { z } from 'zod';
import { CaseManifestSchema, type CaseManifest } from '../src/domain/schema.js';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function refundConfirmed(c: CaseManifest): boolean {
	const p = c.payment,
		r = c.refund;
	return Boolean(
		p?.verified &&
			r?.verified &&
			r.status === 'confirmed' &&
			r.transactionHash &&
			r.blockHash &&
			r.blockNumber &&
			same(r.payer, p.payer) &&
			same(r.authorizer, p.seller) &&
			same(r.token, p.token) &&
			r.amount === p.amount &&
			(r.reason !== 'quality' ||
				(c.court?.verified &&
					c.court.status === 'finalized' &&
					c.court.result?.decision === 'REFUND')),
	);
}
function validated(value: unknown): CaseManifest {
	const result = CaseManifestSchema.safeParse(value);
	if (!result.success)
		throw new Error(
			'Case data did not pass validation. The published evidence cannot be displayed.',
		);
	const c = result.data,
		p = c.payment,
		r = c.refund;
	const consistent =
		!p ||
		(same(p.payer, c.agreement.buyer) &&
			same(p.seller, c.agreement.seller) &&
			p.amount === c.agreement.amount);
	const refundMatches =
		!r ||
		(same(r.payer, c.agreement.buyer) &&
			same(r.authorizer, c.agreement.seller) &&
			r.amount === c.agreement.amount);
	const courtMatches =
		!c.court ||
		(same(c.court.caseId, c.id) &&
			(!c.evidenceHash || same(c.court.evidenceHash, c.evidenceHash)));
	if (
		!consistent ||
		!refundMatches ||
		!courtMatches ||
		(c.status === 'refunded' && !refundConfirmed(c))
	)
		throw new Error(
			'Case evidence failed validation: the receipts do not match this agreement.',
		);
	return c;
}
export function parseCase(value: unknown): CaseManifest {
	const envelope = z.object({ case: z.unknown() }).safeParse(value);
	if (!envelope.success)
		throw new Error('Case response did not pass validation.');
	return validated(envelope.data.case);
}
export function parseCases(value: unknown): CaseManifest[] {
	const envelope = z
		.object({ cases: z.array(z.unknown()).max(100) })
		.safeParse(value);
	if (!envelope.success) throw new Error('Case list did not pass validation.');
	return envelope.data.cases
		.map(validated)
		.sort(
			(a, b) =>
				Number(a.mode === 'simulation') - Number(b.mode === 'simulation') ||
				Number(refundConfirmed(b)) - Number(refundConfirmed(a)) ||
				b.createdAt.localeCompare(a.createdAt),
		);
}
export function formatMoney(baseUnits: string): string {
	if (!/^[0-9]+$/.test(baseUnits)) return 'Unavailable';
	const amount = BigInt(baseUnits);
	const fraction = (amount % 1000000n)
		.toString()
		.padStart(6, '0')
		.replace(/0+$/, '');
	return (amount / 1000000n).toString() + (fraction ? '.' + fraction : '');
}
export function shortHash(value: string): string {
	return value.slice(0, 8) + '…' + value.slice(-6);
}
export function statusLabel(c: CaseManifest): string {
	if (refundConfirmed(c)) return 'Refund confirmed';
	if (
		c.refund &&
		['failed', 'reserve_shortfall', 'canceled'].includes(c.refund.status)
	)
		return {
			failed: 'Refund failed',
			reserve_shortfall: 'Refund reserve shortfall',
			canceled: 'Refund authorization canceled',
		}[c.refund.status as 'failed' | 'reserve_shortfall' | 'canceled'];
	const labels: Record<CaseManifest['status'], string> = {
		simulation: 'Simulation',
		awaiting_payment: 'Awaiting payment',
		delivered: 'Answer delivered',
		accepted: 'Accepted by buyer',
		disputed: 'Buyer disputed the answer',
		court_pending: 'Court reviewing evidence',
		court_provisional: 'Provisional ruling',
		court_finalized: 'Ruling finalized',
		refund_pending: 'Refund awaiting confirmation',
		refunded: 'Refund unverified',
		unresolved: 'Case unresolved',
	};
	return labels[c.status];
}
export function safeExternalUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}
export function proofLinks(c: CaseManifest) {
	const explorer =
		c.court?.network === 'studionet'
			? 'https://explorer-studio.genlayer.com'
			: 'https://explorer.genlayer.com';
	return {
		payment: c.payment
			? 'https://sepolia.basescan.org/tx/' + c.payment.transactionHash
			: null,
		refund: c.refund?.transactionHash
			? 'https://sepolia.basescan.org/tx/' + c.refund.transactionHash
			: null,
		contract: c.court ? explorer + '/address/' + c.court.contractAddress : null,
		courtTransaction: c.court?.transactionHash
			? explorer + '/tx/' + c.court.transactionHash
			: null,
	};
}
export function sourceLabel(c: CaseManifest): string {
	if (c.mode === 'simulation') return 'Simulation · no chain activity';
	if (c.provenance.source === 'recorded') return 'Recorded testnet case';
	if (c.mode === 'fixture') return 'Testnet case · demo delivery';
	return 'Live testnet case';
}
export function displayTime(value: string): string {
	return new Date(value).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}
