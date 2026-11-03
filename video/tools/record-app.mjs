/**
 * Records the real app (production) for the app scenes. Every click is scheduled
 * from the narration's word timestamps so actions land on the spoken words.
 * Writes video/build/app/raw.webm and marks.json (scene start times in the video).
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(import.meta.dirname, '../..');
const OUT = join(ROOT, 'video/build/app');
const BASE = process.env.BASE ?? 'https://puzzlear.jacob.workers.dev';
const sb = JSON.parse(readFileSync(join(ROOT, 'video/storyboard.json'), 'utf8'));
const LEAD = sb.lead ?? 0.8;
const man = JSON.parse(readFileSync(join(ROOT, 'video/build/narration/manifest.json'), 'utf8'));
const W = 1600, H = 900;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: W, height: H } } });
// a visible cursor with a click ripple (Playwright does not render one)
await ctx.addInitScript(() => {
	addEventListener('DOMContentLoaded', () => {
		const c = document.createElement('div');
		c.innerHTML = '<svg width="30" height="34" viewBox="0 0 30 34"><path d="M3 2l22 14-9.5 2.2L11 28z" fill="#24312d" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>';
		Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)', transition: 'none' });
		document.body.appendChild(c);
		const pos = JSON.parse(sessionStorage.getItem('cur') ?? '[800,450]');
		c.style.left = pos[0] + 'px';
		c.style.top = pos[1] + 'px';
		addEventListener('mousemove', (e) => {
			c.style.left = e.clientX + 'px';
			c.style.top = e.clientY + 'px';
			sessionStorage.setItem('cur', JSON.stringify([e.clientX, e.clientY]));
		}, true);
		addEventListener('mousedown', (e) => {
			const r = document.createElement('div');
			Object.assign(r.style, { position: 'fixed', left: e.clientX - 22 + 'px', top: e.clientY - 22 + 'px', width: '44px', height: '44px', borderRadius: '50%', border: '3px solid #167A6B', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out' });
			document.body.appendChild(r);
			requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
			setTimeout(() => r.remove(), 600);
		}, true);
	});
});
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const sleep = (s) => new Promise((r) => setTimeout(r, Math.max(0, s * 1000)));
let cur = { x: 800, y: 450 };
const marks = {};
let sceneStart = 0;

function word(scene, w, occ = 0) {
	const words = man[scene].words;
	let seen = 0;
	for (const x of words) if (x.text.toLowerCase().replace(/[^a-z']/g, '') === w && seen++ === occ) return LEAD + x.start;
	throw new Error(`${scene}: no word ${w}`);
}
const at = (t) => sleep(sceneStart + t - now());
async function moveTo(x, y, dur = 0.7) {
	const steps = Math.max(8, Math.round(dur * 40));
	for (let i = 1; i <= steps; i++) {
		const k = i / steps;
		const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
		await page.mouse.move(cur.x + (x - cur.x) * e, cur.y + (y - cur.y) * e);
		await sleep(dur / steps);
	}
	cur = { x, y };
}
async function centerOf(locator) {
	const b = await locator.boundingBox();
	if (!b) throw new Error('no box');
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function moveToEl(locator, dur) {
	const c = await centerOf(locator);
	await moveTo(c.x, c.y, dur);
}
async function click() {
	await page.mouse.down();
	await sleep(0.08);
	await page.mouse.up();
}
/** Screen position of an image-space point on the photo stage. */
async function imageToScreen(x, y) {
	return page.evaluate(([x, y]) => {
		const svg = document.querySelector('[role=application] svg');
		const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
		return { x: p.x, y: p.y };
	}, [x, y]);
}
/** Screen position of a piece's number tag on the photo. */
async function tagOnPhoto(label) {
	return page.evaluate((label) => {
		const t = [...document.querySelectorAll('[role=application] svg text')].find((el) => el.textContent === label);
		const r = t.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	}, label);
}
function begin(name) {
	sceneStart = now();
	marks[name] = sceneStart;
	console.log('scene', name, sceneStart.toFixed(2));
}
const length = (name) => LEAD + man[name].duration_s + sb.scenes.find((s) => s.name === name).pad + (sb.crossfade ?? 0.6) + 0.2;

// ---------------- s03: landing -> sample -> review ----------------
await page.goto(BASE + '/');
await page.waitForLoadState('networkidle');
await moveTo(700, 520, 0.2);
await sleep(1.0);
begin('v04_snap');
await at(word('v04_snap', 'sample') - 0.6);
await moveToEl(page.getByRole('button', { name: /Try Sample Puzzle/ }).first(), 0.7);
await click();
await page.getByText('Found 16 pieces').waitFor();
await at(word('v04_snap', 'outlines') - 0.4);
const t7 = await tagOnPhoto('07');
await moveTo(t7.x, t7.y, 0.9);
await at(word('v04_snap', 'number'));
await click();
await at(length('v04_snap'));

// ---------------- s06: solve, evidence, fits ----------------
await page.keyboard.press('Escape');
await moveToEl(page.getByRole('button', { name: /Find Matches/ }), 0.6);
await sleep(0.3);
begin('v06_find');
await click();
await page.getByText(/Option 1 of/).waitFor();
await at(word('v06_find', 'tap') - 1.0);
const chip = page.getByRole('button', { name: /Some edges need a closer look/ });
await moveToEl(chip, 0.7);
await at(word('v06_find', 'tap'));
await click();
await sleep(0.5);
await at(word('v06_find', 'why'));
await page.getByRole('button', { name: /^Fits$/ }).first().evaluate((el) => el.closest('li').scrollIntoView({ behavior: 'smooth', block: 'center' }));
await sleep(0.9);
await at(word('v06_find', 'stay') - 0.3);
const fits = page.getByRole('button', { name: /^Fits$/ }).first();
await moveToEl(fits, 0.8);
await at(word('v06_find', 'confirm'));
await click();
await at(word('v06_find', 'adjust'));
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await at(length('v06_find'));

// off camera: go to the guide
await page.getByRole('button', { name: /Start Assembling/ }).click();
await page.waitForURL(/guide/);
await page.getByText(/Step 1 of/).filter({ visible: true }).first().waitFor();
await sleep(1.2);

// ---------------- s08: guide ----------------
begin('v07_place');
const findLabel = (await page.getByRole('heading', { level: 1 }).first().textContent()).match(/#(\d+)/)[1];
await at(word('v07_place', 'which') - 0.3);
const tp = await tagOnPhoto(findLabel);
await moveTo(tp.x, tp.y, 0.8);
await at(word('v07_place', 'where'));
await moveToEl(page.locator('[aria-label="Puzzle board, 4 rows by 4 columns"] button[aria-label]').filter({ has: page.locator('span') }).first(), 0.7);
await at(word('v07_place', 'mark') - 0.6);
await moveToEl(page.getByRole('button', { name: /Set assembly area/ }), 0.6);
await click();
const meta = await (await page.request.get(BASE + '/sample/sample-4x4/meta.json')).json();
const taps = meta.boardQuad;
for (let i = 0; i < 4; i++) {
	const s = await imageToScreen(taps[i].x, taps[i].y);
	await moveTo(s.x, s.y, 0.32);
	await click();
}
await at(word('v07_place', 'new') - 0.5);
await moveToEl(page.getByRole('button', { name: /Check Placement/ }), 0.6);
await at(word('v07_place', 'checks'));
await click();
await at(word('v07_place', 'or') - 0.2);
await moveToEl(page.getByRole('button', { name: /^I placed it$/ }).first(), 0.7);
await at(word('v07_place', 'confirm'));
await click();
await at(length('v07_place'));

// ---------------- s09: finish ----------------
begin('v08_finish');
await sleep(0.4);
for (let i = 0; i < 80; i++) {
	if (page.url().includes('/done')) break;
	const btn = page.getByRole('button', { name: /^I placed it$/ }).filter({ visible: true }).last();
	if (!(await btn.isVisible().catch(() => false))) {
		await sleep(0.2);
		continue;
	}
	await moveToEl(btn, 0.12);
	await click();
	await sleep(0.22);
	if (i % 5 === 0) console.log('loop', i, page.url(), await page.getByText(/Step \d+ of/).filter({ visible: true }).first().textContent().catch(() => '?'));
}
await page.screenshot({ path: join(OUT, 'debug.png') });
await page.waitForURL(/done/);
await at(length('v08_finish') - 2.2);
await moveToEl(page.getByRole('button', { name: /Download assembled.png/ }), 0.7);
await at(length('v08_finish') + 0.5);

await page.close();
await ctx.close();
await browser.close();
const vid = readdirSync(OUT).find((f) => f.endsWith('.webm') && f !== 'raw.webm');
renameSync(join(OUT, vid), join(OUT, 'raw.webm'));
writeFileSync(join(OUT, 'marks.json'), JSON.stringify(marks, null, 1));
console.log('done', marks);
