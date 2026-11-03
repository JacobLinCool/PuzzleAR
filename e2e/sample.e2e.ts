import { expect, test } from '@playwright/test';

test('sample puzzle: scan, solve, guide, verify, finish, delete', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('pieces that don');
	await page.getByRole('button', { name: /Try Sample Puzzle/ }).click();

	await page.waitForURL(/\/review$/);
	await expect(page.getByText('Found 16 pieces')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText(/These outlines replay a real Meta SAM 3.1 response/)).toBeVisible();
	await expect(page.getByRole('button', { name: /Find Matches/ })).toBeEnabled({ timeout: 20_000 });

	// a removal blocks solving until undone
	await page.getByRole('button', { name: 'Piece #01', exact: true }).click();
	await page.getByRole('button', { name: /^Remove$/ }).last().click();
	await expect(page.getByText(/We found 15 pieces, but your grid needs 16/)).toBeVisible();
	await page.keyboard.press('z');
	await expect(page.getByText('Found 16 pieces')).toBeVisible();

	await page.getByRole('button', { name: /Find Matches/ }).click();
	await page.waitForURL(/\/solve$/);
	await expect(page.getByText(/Option 1 of \d/)).toBeVisible({ timeout: 30_000 });

	// refresh restores the session
	await page.reload();
	await expect(page.getByText(/Option 1 of \d/)).toBeVisible({ timeout: 30_000 });

	await page.getByRole('button', { name: /Start Assembling/ }).click();
	await page.waitForURL(/\/guide$/);
	await expect(page.getByText(/Step 1 of 16/).filter({ visible: true }).first()).toBeVisible();
	await page.getByRole('button', { name: /Use the marked frame/ }).click();
	await page.getByRole('button', { name: /Check Placement/ }).click();
	await expect(page.getByText('Verified from the photo')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText(/Step 2 of 16/).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });

	for (let i = 0; i < 15; i++) {
		await page.getByRole('button', { name: /^I placed it$/ }).first().click();
		if (i < 14) await expect(page.getByText(new RegExp(`Step ${i + 3} of 16`)).filter({ visible: true }).first()).toBeVisible();
	}
	await page.waitForURL(/\/done$/);
	await expect(page.getByText('The final piece fits. Nice work together.')).toBeVisible();

	const id = page.url().split('/p/')[1].split('/')[0];
	const json = await page.request.get(`/api/sessions/${id}/export?format=json`);
	expect(json.ok()).toBe(true);
	expect((await json.json()).placements).toHaveLength(16);

	await page.getByRole('button', { name: /Delete this session/ }).click();
	await page.getByRole('button', { name: /Delete everything/ }).click();
	await page.waitForURL((u) => u.pathname === '/');
	expect((await page.request.get(`/api/sessions/${id}`)).status()).toBe(404);
	expect(errors).toEqual([]);
});

test('sessions are private to the browser that created them', async ({ page, browser }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /Try Sample Puzzle/ }).click();
	await page.waitForURL(/\/review$/);
	const url = page.url();
	const other = await browser.newContext();
	const res = await other.request.get(url.replace(/\/review$/, '').replace('/p/', '/api/sessions/'));
	expect(res.status()).toBe(403);
	await other.close();
});
