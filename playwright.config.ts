import { defineConfig, devices } from '@playwright/test';

// Runs the built Worker locally (D1/R2 emulated by wrangler). The sample flow
// replays a stored SAM response, so no Meta API calls are made.
export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	timeout: 90_000,
	webServer: {
		command: 'pnpm build && pnpm exec wrangler d1 migrations apply puzzlear --local && pnpm exec wrangler dev --port 4173 --local',
		port: 4173,
		reuseExistingServer: true,
		timeout: 180_000
	},
	use: { baseURL: 'http://localhost:4173' },
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] } },
		{ name: 'mobile', use: { ...devices['Pixel 7'] } }
	]
});
