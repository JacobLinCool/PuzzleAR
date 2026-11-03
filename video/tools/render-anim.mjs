/**
 * Renders explainer scenes frame by frame (deterministic seek) into mp4 clips.
 * Usage: node video/tools/render-anim.mjs [scene...]  (needs `python3 -m http.server 8899` at repo root)
 * Stills mode: node video/tools/render-anim.mjs --stills scene t1,t2,...
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(import.meta.dirname, '../..');
const BUILD = join(ROOT, 'video/build');
const FPS = 30;
const sb = JSON.parse(readFileSync(join(ROOT, 'video/storyboard.json'), 'utf8'));
const manifestPath = join(BUILD, 'narration/manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const args = process.argv.slice(2);
const stills = args[0] === '--stills';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:8899/video/anim/index.html');
mkdirSync(join(BUILD, 'clips'), { recursive: true });

async function setup(scene) {
	const m = manifest[scene.name];
	const duration = (m?.duration_s ?? 8) + 0.8 + scene.pad + 0.8;
	await page.evaluate((o) => window.setup(o), { scene: scene.name, words: m?.words ?? [], lead: 0.8, duration });
	return duration;
}

if (stills) {
	const scene = sb.scenes.find((s) => s.name === args[1]);
	await setup(scene);
	for (const t of args[2].split(',').map(Number)) {
		await page.evaluate((t) => window.seek(t), t);
		await page.screenshot({ path: join(BUILD, `still-${scene.name}-${t}.png`) });
	}
} else {
	const wanted = args.length ? args : sb.scenes.filter((s) => s.kind === 'anim').map((s) => s.name);
	for (const name of wanted) {
		const scene = sb.scenes.find((s) => s.name === name);
		const duration = await setup(scene);
		const frames = Math.ceil(duration * FPS);
		const out = join(BUILD, 'clips', `${name}.mp4`);
		const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium', out], { stdio: ['pipe', 'inherit', 'inherit'] });
		for (let f = 0; f < frames; f++) {
			await page.evaluate((t) => window.seek(t), f / FPS);
			const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
			if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
		}
		ff.stdin.end();
		await new Promise((r) => ff.on('close', r));
		console.log(`${name}: ${frames} frames (${duration.toFixed(2)}s)`);
	}
}
await browser.close();
