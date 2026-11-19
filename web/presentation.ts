import type { CaseManifest } from '../src/domain/schema.js';
import { refundConfirmed, statusLabel } from './model.js';

export type Stage = {
	label: string;
	detail: string;
	state: 'complete' | 'active' | 'pending' | 'failed' | 'skipped';
};
export function initialSelection(search: string): string | null {
	const value = new URLSearchParams(search).get('case');
	return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? value : null;
}
export function stagesFor(c: CaseManifest): Stage[] {
	const accepted = c.status === 'accepted' && c.buyerClaim?.action === 'accept';
	const final = c.court?.verified && c.court.status === 'finalized';
	const nonDelivery = c.refund?.reason === 'non_delivery';
	const refundFailed =
		c.refund &&
		['failed', 'reserve_shortfall', 'canceled'].includes(c.refund.status);
	return [
		{
			label: 'Agreement',
			detail: 'Brief and quality rubric',
			state: 'complete',
		},
		{
			label: 'x402 payment',
			detail: c.payment?.verified
				? 'USDC transfer verified'
				: c.payment
					? 'Transfer unverified'
					: 'Awaiting payment',
			state: c.payment?.verified
				? 'complete'
				: c.payment
					? 'active'
					: 'pending',
		},
		{
			label: 'Buyer review',
			detail:
				c.buyerClaim?.action === 'dispute'
					? 'Material failure claimed'
					: accepted
						? 'Work accepted'
						: c.delivery
							? 'Answer ready for review'
							: 'Awaiting delivery',
			state: c.buyerClaim ? 'complete' : c.delivery ? 'active' : 'pending',
		},
		{
			label: 'Internet Court',
			detail: final
				? 'GenLayer ruling finalized'
				: accepted || nonDelivery
					? 'Ruling not required'
					: c.court?.status === 'accepted'
						? 'Provisional ruling'
						: c.court
							? 'Review in progress'
							: 'Awaiting a dispute',
			state:
				accepted || nonDelivery
					? 'skipped'
					: c.court?.status === 'failed'
						? 'failed'
						: final
							? 'complete'
							: c.court
								? 'active'
								: 'pending',
		},
		{
			label: 'Refund',
			detail: refundConfirmed(c)
				? 'USDC returned to buyer'
				: refundFailed
					? statusLabel(c)
					: accepted || (c.court?.result?.decision === 'NO_REFUND' && final)
						? 'No refund due'
						: c.refund
							? 'Transfer not yet confirmed'
							: 'Awaiting ruling',
			state: refundConfirmed(c)
				? 'complete'
				: refundFailed
					? 'failed'
					: accepted || (c.court?.result?.decision === 'NO_REFUND' && final)
						? 'skipped'
						: c.refund
							? 'active'
							: 'pending',
		},
	];
}
export function outcomeFor(c: CaseManifest): {
	title: string;
	detail: string;
	tone: 'success' | 'neutral' | 'failure';
} {
	if (refundConfirmed(c))
		return {
			title: 'The buyer got its money back.',
			detail:
				'The seller returned the full paid principal. The transfer is verified on Base Sepolia.',
			tone: 'success',
		};
	if (c.status === 'accepted')
		return {
			title: 'The buyer accepted the work.',
			detail:
				'The answer met the buyer’s needs. No dispute or refund was required.',
			tone: 'neutral',
		};
	if (
		c.refund &&
		['failed', 'reserve_shortfall', 'canceled'].includes(c.refund.status)
	)
		return {
			title: 'The refund needs attention.',
			detail: statusLabel(c) + '. A court award does not confirm a transfer.',
			tone: 'failure',
		};
	if (c.court?.verified && c.court.status === 'finalized') {
		if (c.court.result?.decision === 'REFUND')
			return {
				title: 'The court awarded a refund.',
				detail:
					'The ruling is final. The seller’s refund transfer still needs confirmation.',
				tone: 'neutral',
			};
		if (c.court.result?.decision === 'NO_REFUND')
			return {
				title: 'The court upheld the purchase.',
				detail:
					'The finalized ruling found no material failure under the agreed rubric.',
				tone: 'neutral',
			};
	}
	if (c.mode === 'simulation')
		return {
			title: 'A rehearsal, with no money moved.',
			detail: c.provenance.disclosure,
			tone: 'neutral',
		};
	if (
		c.status === 'unresolved' ||
		c.court?.result?.decision === 'INSUFFICIENT_EVIDENCE'
	)
		return {
			title: 'This case is unresolved.',
			detail:
				'The available evidence has not produced a verified final outcome. No automatic refund follows.',
			tone: 'neutral',
		};
	return {
		title: 'The case is still in progress.',
		detail:
			statusLabel(c) + '. Each stage below updates from the published case.',
		tone: 'neutral',
	};
}
