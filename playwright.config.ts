import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: 'tests/e2e',
	workers: 1,
	use: {
		baseURL: 'http://127.0.0.1:5173',
		viewport: { width: 1280, height: 900 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	webServer: {
		command: 'node --import tsx tools/dev.ts --web',
		url: 'http://127.0.0.1:5173',
		reuseExistingServer: !process.env.CI,
		timeout: 60000,
	},
});
