import test from 'node:test';
import assert from 'node:assert/strict';
import {
	stagesFor,
	outcomeFor,
	initialSelection,
} from '../../web/presentation.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaseDetail } from '../../web/case-detail.js';
import { sampleCase, paidCase, refundedCase, hash } from './sample.js';

test('empty simulation never claims a payment, decision, or refund', () => {
	assert.deepEqual(
		stagesFor(sampleCase()).map((s) => s.state),
		['complete', 'pending', 'pending', 'pending', 'pending'],
	);
	assert.equal(outcomeFor(sampleCase()).tone, 'neutral');
});
test('payment and refund confirmations require verified evidence', () => {
	assert.equal(stagesFor(paidCase())[1]?.state, 'complete');
	const c = refundedCase();
	assert.equal(stagesFor(c)[4]?.state, 'complete');
	assert.equal(outcomeFor(c).title, 'The buyer got its money back.');
	assert.equal(
		stagesFor({
			...c,
			status: 'refund_pending',
			refund: { ...c.refund!, status: 'pending', verified: false },
		})[4]?.state,
		'active',
	);
	assert.equal(
		stagesFor({
			...paidCase(),
			payment: { ...paidCase().payment!, verified: false },
		})[1]?.state,
		'active',
	);
});
test('provisional court outcome stays provisional', () => {
	const c = refundedCase();
	const provisional = {
		...c,
		status: 'court_provisional' as const,
		court: { ...c.court!, status: 'accepted' as const, verified: false },
		refund: null,
	};
	assert.equal(stagesFor(provisional)[3]?.state, 'active');
	assert.equal(outcomeFor(provisional).tone, 'neutral');
});
test('location-derived identifiers reject malformed and external URLs', () => {
	assert.equal(initialSelection('?case=' + hash('1')), hash('1'));
	assert.equal(initialSelection('?case=../secret'), null);
	assert.equal(initialSelection('?case=https://example.com'), null);
});
test('delivery is escaped and simulation exposes no fake transaction links', () => {
	const text = '<script>alert("evidence")</script> Promote it online.';
	const c = sampleCase({
		delivery: { text, hash: hash('5'), committedAt: 1795000000 },
	});
	const html = renderToStaticMarkup(CaseDetail({ caseFile: c }));
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(!html.includes('<script>'));
	assert.ok(!html.includes('sepolia.basescan.org/tx/'));
	assert.ok(html.includes('Simulation'));
});
test('confirmed refund UI exposes the original payment, court, and transfer receipts', () => {
	const html = renderToStaticMarkup(CaseDetail({ caseFile: refundedCase() }));
	assert.ok(html.includes('The buyer got its money back.'));
	assert.ok(html.includes('https://sepolia.basescan.org/tx/' + hash('3')));
	assert.ok(html.includes('https://sepolia.basescan.org/tx/' + hash('9')));
	assert.ok(html.includes('Finalized'));
});
