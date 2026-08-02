import { defineConfig } from '@playwright/test'

/*
End-to-end tests. These drive a real Chrome with the extension installed and a
real socket server, so they are slow and stateful — one worker, no parallelism.
See e2e/README.md for what they can and cannot cover.
*/
export default defineConfig({
	testDir: './e2e',
	// Two browser profiles per test plus a video that plays in real time.
	timeout: 90_000,
	expect: { timeout: 15_000 },
	// The socket server is shared process state (rooms live in memory), so
	// tests must not overlap.
	workers: 1,
	fullyParallel: false,
	retries: 0,
	reporter: [['list']],
	use: {
		trace: process.env.CI ? 'off' : 'retain-on-failure',
	},
})
