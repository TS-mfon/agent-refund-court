import { test, expect, type Page } from '@playwright/test';
import { sampleCase, refundedCase, hash } from '../ui/sample.js';
import type { CaseManifest } from '../../src/domain/schema.js';

async function api(
	page: Page,
	cases: CaseManifest[],
	options: { broken?: boolean } = {},
) {
	await page.route('**/api/v1/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/v1/service')
			return route.fulfill({
				json: {
					service: {
						id: 'launch-plan-v1',
						priceBaseUnits: '10000',
						symbol: 'USDC',
						network: 'eip155:84532',
						courtNetwork: 'studionet',
						repository: 'https://github.com/TS-mfon/agent-refund-court',
						capabilities: { purchase: true, generation: true },
					},
				},
			});
		if (options.broken)
			return route.fulfill({
				status: 503,
				json: { error: 'service unavailable' },
			});
		if (path === '/api/v1/cases') return route.fulfill({ json: { cases } });
		if (path.endsWith('/evidence'))
			return route.fulfill({
				json: {
					evidence: {
						disclosure: 'Explicit E2E test fixture; no real chain operations.',
						delivery: cases[0]?.delivery,
					},
				},
			});
		const c = cases.find((value) => path === '/api/v1/cases/' + value.id);
		return route.fulfill({
			status: c ? 200 : 404,
			json: c ? { case: c } : { error: 'not found' },
		});
	});
}
test('empty state has no invented case, receipt, or verdict', async ({
	page,
}) => {
	await api(page, []);
	await page.goto('/');
	await expect(
		page.getByRole('heading', { name: 'No case has been published yet.' }),
	).toBeVisible();
	await expect(
		page.getByRole('link', { name: 'Run with an agent', exact: true }).last(),
	).toBeVisible();
	await expect(page.locator('a[href*="basescan.org/tx/"]')).toHaveCount(0);
	await expect(page.getByAltText('Internet Court')).toBeVisible();
	await expect(page.getByAltText('GenLayer')).toBeVisible();
	await expect(page.getByAltText('x402')).toBeVisible();
});
test('viewer exposes verified transfer links, escaped original delivery, and sealed evidence', async ({
	page,
}, testInfo) => {
	const c = refundedCase();
	await api(page, [c]);
	await page.goto('/');
	await expect(
		page.getByRole('heading', { name: 'The buyer got its money back.' }),
	).toBeVisible();
	await expect(
		page.getByText('<script>alert("evidence")</script> Promote it online.', {
			exact: true,
		}),
	).toBeVisible();
	await expect(
		page.locator('a[href="https://sepolia.basescan.org/tx/' + hash('3') + '"]'),
	).toBeVisible();
	await expect(
		page.locator('a[href="https://sepolia.basescan.org/tx/' + hash('9') + '"]'),
	).toBeVisible();
	await page.getByRole('button', { name: 'Inspect sealed evidence' }).click();
	await expect(page.locator('#evidence-json')).toContainText(
		'Explicit E2E test fixture',
	);
	await page.getByRole('button', { name: 'Hide sealed evidence' }).click();
	await expect(page.locator('#evidence-json')).toHaveCount(0);
	await page.getByRole('checkbox', { name: 'Auto-refresh' }).uncheck();
	await expect(
		page.getByRole('checkbox', { name: 'Auto-refresh' }),
	).not.toBeChecked();
	await page.screenshot({
		path: testInfo.outputPath('desktop.png'),
		fullPage: true,
	});
});
test('case selection updates the URL and reloads the original case', async ({
	page,
}) => {
	const first = sampleCase({ id: hash('c') }),
		second = sampleCase({
			id: hash('d'),
			delivery: {
				text: 'Second rehearsal answer.',
				hash: hash('e'),
				committedAt: 1795000000,
			},
		});
	await api(page, [first, second]);
	await page.goto('/');
	await page.getByRole('button', { name: new RegExp('0xdddddd') }).click();
	await expect(page).toHaveURL(new RegExp('case=' + hash('d')));
	await expect(
		page.getByText('Second rehearsal answer.', { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'A rehearsal, with no money moved.' }),
	).toBeVisible();
});
test('service failures remain retryable and never imply a result', async ({
	page,
}) => {
	await api(page, [], { broken: true });
	await page.goto('/');
	await expect(page.getByRole('alert')).toContainText('503');
	await expect(
		page.getByRole('button', { name: 'Retry', exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'The buyer got its money back.' }),
	).toHaveCount(0);
});
test('mobile viewer fits the viewport and keeps the case controls accessible', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await api(page, [refundedCase()]);
	await page.goto('/');
	await expect(
		page.getByRole('heading', { name: 'The buyer got its money back.' }),
	).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth,
	);
	expect(overflow).toBe(false);
	await expect(
		page.getByRole('button', { name: 'Refresh', exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath('mobile.png'),
		fullPage: true,
	});
});
