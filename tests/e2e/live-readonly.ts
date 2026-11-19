import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import {
	parseCase,
	parseCases,
	proofLinks,
	refundConfirmed,
} from '../../web/model.js';

const args = process.argv.slice(2);
const originIndex = args.indexOf('--origin');
const requestedOrigin =
	originIndex >= 0
		? args[originIndex + 1]
		: 'https://agent-refund-court.vercel.app';
const origin = new URL(requestedOrigin).origin;
assert.equal(new URL(origin).protocol, 'https:');
assert.ok(
	origin === 'https://agent-refund-court.vercel.app' ||
		/^https:\/\/agent-refund-court-[a-z0-9-]+-gen-daves-projects\.vercel\.app$/.test(
			origin,
		),
);
const caseId = args.includes('--case')
	? args[args.indexOf('--case') + 1]
	: null;
assert.ok(!caseId || /^0x[0-9a-fA-F]{64}$/.test(caseId));
let phase = 'health';
const statuses: Record<string, number> = {};
async function read(path: string, label: string): Promise<unknown> {
	const response = await fetch(origin + path, {
		cache: 'no-store',
		signal: AbortSignal.timeout(20000),
	});
	statuses[label] = response.status;
	assert.equal(response.status, 200, label + '_HTTP_' + response.status);
	return response.json();
}
async function main() {
	const health = (await read('/api/v1/health', 'health')) as {
		success?: boolean;
	};
	assert.equal(health.success, true);
	phase = 'service';
	const serviceResponse = (await read('/api/v1/service', 'service')) as {
		service?: {
			id?: string;
			capabilities?: { purchase?: boolean; generation?: boolean };
			courtAddress?: string;
			repository?: string;
		};
	};
	const service = serviceResponse.service;
	assert.equal(service?.id, 'launch-plan-v1');
	assert.equal(service?.capabilities?.purchase, true);
	assert.equal(service?.capabilities?.generation, true);
	assert.ok(/^0x[0-9a-fA-F]{40}$/.test(service?.courtAddress ?? ''));
	phase = 'cases';
	const cases = parseCases(await read('/api/v1/cases', 'cases'));
	const selected = caseId
		? parseCase(await read('/api/v1/cases/' + caseId, 'case'))
		: null;
	if (selected) assert.equal(selected.id.toLowerCase(), caseId?.toLowerCase());
	if (selected?.evidenceHash)
		await read('/api/v1/cases/' + selected.id + '/evidence', 'evidence');
	phase = 'desktop-browser';
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
	});
	const page = await context.newPage();
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const networkFailures: { path: string; status: number }[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error')
			consoleErrors.push(message.text().slice(0, 200));
	});
	page.on('pageerror', (error) => pageErrors.push(error.name));
	page.on('response', (response) => {
		if (response.url().startsWith(origin) && response.status() >= 400)
			networkFailures.push({
				path: new URL(response.url()).pathname,
				status: response.status(),
			});
	});
	try {
		const response = await page.goto(
			origin + (selected ? '/?case=' + selected.id : '/'),
			{ waitUntil: 'networkidle', timeout: 45000 },
		);
		assert.equal(response?.status(), 200);
		await page
			.getByRole('heading', { name: 'A bad answer can become a fair outcome.' })
			.waitFor();
		await page.getByRole('checkbox', { name: 'Auto-refresh' }).uncheck();
		if (!cases.length && !selected)
			await page
				.getByRole('heading', { name: 'No case has been published yet.' })
				.waitFor();
		if (selected) {
			await page.locator('.case-detail').waitFor();
			assert.ok(
				(await page.locator('.case-reference').innerText()).includes(
					selected.id.slice(0, 8),
				),
			);
			const links = proofLinks(selected);
			for (const url of [
				links.payment,
				links.refund,
				links.courtTransaction,
				links.contract,
			]) {
				if (url)
					assert.ok(
						await page
							.locator('a')
							.evaluateAll(
								(nodes, expected) =>
									nodes.some((node) => node.getAttribute('href') === expected),
								url,
							),
					);
			}
			if (refundConfirmed(selected))
				await page
					.getByRole('heading', { name: 'The buyer got its money back.' })
					.waitFor();
		}
		for (const name of ['Internet Court', 'GenLayer', 'x402']) {
			const logo = page.getByAltText(name);
			assert.ok(await logo.isVisible());
			assert.ok(
				await logo.evaluate(
					(node) =>
						node instanceof HTMLImageElement &&
						node.complete &&
						node.naturalWidth > 0,
				),
			);
		}
		const desktopOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth,
		);
		assert.equal(desktopOverflow, false);
		assert.equal(
			await page
				.locator(
					'a[href="https://github.com/TS-mfon/agent-refund-court/blob/main/docs/reproduction.md"]',
				)
				.count(),
			1,
		);
		let captures: Record<string, string> | null = null;
		if (selected && refundConfirmed(selected)) {
			const directory = await mkdtemp(
				join(tmpdir(), 'agent-refund-court-live-'),
			);
			await mkdir(directory, { recursive: true });
			captures = {
				overview: join(directory, 'overview.png'),
				delivery: join(directory, 'delivery.png'),
				receipts: join(directory, 'receipts.png'),
				mobile: join(directory, 'mobile.png'),
			};
			await page.screenshot({ path: captures.overview, fullPage: true });
			await page
				.locator('.delivery-section')
				.screenshot({ path: captures.delivery });
			await page.locator('.receipts').screenshot({ path: captures.receipts });
		}
		phase = 'mobile-browser';
		await page.setViewportSize({ width: 390, height: 844 });
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth,
			),
			false,
		);
		for (const name of ['Internet Court', 'GenLayer', 'x402'])
			assert.ok(await page.getByAltText(name).isVisible());
		if (captures)
			await page.screenshot({ path: captures.mobile, fullPage: true });
		assert.equal(consoleErrors.length, 0);
		assert.equal(pageErrors.length, 0);
		assert.equal(networkFailures.length, 0);
		console.log(
			JSON.stringify(
				{
					healthy: true,
					origin,
					statuses,
					purchase: service?.capabilities?.purchase,
					generation: service?.capabilities?.generation,
					caseCount: cases.length,
					selectedCase: selected
						? {
								id: selected.id,
								status: selected.status,
								refundConfirmed: refundConfirmed(selected),
							}
						: null,
					desktop: { overflow: desktopOverflow, logos: 3 },
					mobile: { overflow: false, logos: 3 },
					consoleErrorCount: consoleErrors.length,
					pageErrorCount: pageErrors.length,
					networkFailures,
					captures,
				},
				null,
				2,
			),
		);
	} finally {
		await context.close();
		await browser.close();
	}
}
main().catch(() => {
	console.error(
		JSON.stringify({
			healthy: false,
			origin,
			phase,
			statuses,
			code: 'LIVE_READONLY_QA_FAILED',
		}),
	);
	process.exitCode = 1;
});
