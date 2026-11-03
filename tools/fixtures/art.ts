/**
 * Procedural puzzle artwork: a sunset lake landscape with enough distinct
 * colour regions that edge colour continuity carries real signal.
 */
import type { SKRSContext2D } from '@napi-rs/canvas';
import { mulberry32 } from '../../src/lib/shared/random';

export function paintArtwork(ctx: SKRSContext2D, w: number, h: number, seed = 7) {
	const rand = mulberry32(seed);
	const horizon = h * 0.56;

	// Sky
	const sky = ctx.createLinearGradient(0, 0, 0, horizon);
	sky.addColorStop(0, '#1d3557');
	sky.addColorStop(0.35, '#5b5f97');
	sky.addColorStop(0.62, '#e07a5f');
	sky.addColorStop(0.85, '#f2cc8f');
	sky.addColorStop(1, '#f6e7b4');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, w, horizon + 2);

	// Stars in the upper sky
	for (let i = 0; i < 60; i++) {
		const x = rand() * w;
		const y = rand() * horizon * 0.3;
		ctx.fillStyle = `rgba(255,255,240,${0.4 + rand() * 0.5})`;
		ctx.beginPath();
		ctx.arc(x, y, 0.6 + rand() * 1.4, 0, Math.PI * 2);
		ctx.fill();
	}

	// Sun
	const sunX = w * 0.68;
	const sunY = horizon * 0.78;
	const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.32);
	glow.addColorStop(0, 'rgba(255,236,170,0.95)');
	glow.addColorStop(0.18, 'rgba(255,200,120,0.55)');
	glow.addColorStop(1, 'rgba(255,170,110,0)');
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, w, horizon);
	ctx.fillStyle = '#fff3c4';
	ctx.beginPath();
	ctx.arc(sunX, sunY, w * 0.055, 0, Math.PI * 2);
	ctx.fill();

	// Clouds
	const cloud = (cx: number, cy: number, s: number, color: string) => {
		ctx.fillStyle = color;
		for (let i = 0; i < 7; i++) {
			ctx.beginPath();
			ctx.ellipse(
				cx + (i - 3) * s * 0.45 + rand() * s * 0.2,
				cy + (rand() - 0.5) * s * 0.25,
				s * (0.45 + rand() * 0.3),
				s * (0.2 + rand() * 0.12),
				0,
				0,
				Math.PI * 2
			);
			ctx.fill();
		}
	};
	cloud(w * 0.22, horizon * 0.42, w * 0.09, 'rgba(250,214,190,0.85)');
	cloud(w * 0.8, horizon * 0.3, w * 0.07, 'rgba(236,180,170,0.8)');
	cloud(w * 0.48, horizon * 0.58, w * 0.06, 'rgba(255,226,196,0.75)');

	// Hot air balloon
	const bx = w * 0.3;
	const by = horizon * 0.62;
	const br = w * 0.075;
	const stripes = ['#c1121f', '#fdf0d5', '#003049', '#f77f00', '#c1121f', '#fdf0d5'];
	for (let i = 0; i < stripes.length; i++) {
		ctx.save();
		ctx.beginPath();
		ctx.ellipse(bx, by, br, br * 1.15, 0, 0, Math.PI * 2);
		ctx.clip();
		ctx.fillStyle = stripes[i];
		ctx.fillRect(bx - br + (i * 2 * br) / stripes.length, by - br * 1.3, (2 * br) / stripes.length + 1, br * 2.6);
		ctx.restore();
	}
	ctx.strokeStyle = '#3d2b1f';
	ctx.lineWidth = Math.max(1, w * 0.002);
	ctx.beginPath();
	ctx.moveTo(bx - br * 0.55, by + br * 0.95);
	ctx.lineTo(bx - br * 0.2, by + br * 1.6);
	ctx.moveTo(bx + br * 0.55, by + br * 0.95);
	ctx.lineTo(bx + br * 0.2, by + br * 1.6);
	ctx.stroke();
	ctx.fillStyle = '#7f5539';
	ctx.fillRect(bx - br * 0.22, by + br * 1.6, br * 0.44, br * 0.32);

	// Far mountains
	const ridge = (base: number, amp: number, color: string, freq: number, phase: number) => {
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(0, horizon + 2);
		for (let x = 0; x <= w; x += w / 120) {
			const y =
				base -
				amp *
					(0.55 * Math.abs(Math.sin((x / w) * Math.PI * freq + phase)) +
						0.3 * Math.sin((x / w) * Math.PI * freq * 2.7 + phase * 1.3) +
						0.15 * Math.sin((x / w) * Math.PI * freq * 6.1));
			ctx.lineTo(x, y);
		}
		ctx.lineTo(w, horizon + 2);
		ctx.closePath();
		ctx.fill();
	};
	ridge(horizon, h * 0.2, '#6d597a', 1.6, 0.4);
	ridge(horizon, h * 0.12, '#355070', 2.4, 1.7);
	ridge(horizon, h * 0.06, '#2a4858', 3.6, 0.2);

	// Lake with reflection
	const lake = ctx.createLinearGradient(0, horizon, 0, h * 0.8);
	lake.addColorStop(0, '#f1c27d');
	lake.addColorStop(0.3, '#c97b63');
	lake.addColorStop(1, '#2b4c6f');
	ctx.fillStyle = lake;
	ctx.fillRect(0, horizon, w, h * 0.26);
	for (let i = 0; i < 90; i++) {
		const y = horizon + rand() * h * 0.24;
		const x = rand() * w;
		const len = w * (0.02 + rand() * 0.08);
		const nearSun = Math.abs(x - sunX) < w * 0.12;
		ctx.strokeStyle = nearSun ? 'rgba(255,240,190,0.85)' : `rgba(255,255,255,${0.15 + rand() * 0.2})`;
		ctx.lineWidth = Math.max(1, h * 0.003);
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + len, y);
		ctx.stroke();
	}

	// Sailboat
	const sx = w * 0.78;
	const sy = horizon + h * 0.12;
	ctx.fillStyle = '#4a2c2a';
	ctx.beginPath();
	ctx.moveTo(sx - w * 0.05, sy);
	ctx.lineTo(sx + w * 0.05, sy);
	ctx.lineTo(sx + w * 0.035, sy + h * 0.02);
	ctx.lineTo(sx - w * 0.035, sy + h * 0.02);
	ctx.fill();
	ctx.fillStyle = '#fefae0';
	ctx.beginPath();
	ctx.moveTo(sx, sy - h * 0.1);
	ctx.lineTo(sx + w * 0.045, sy - h * 0.005);
	ctx.lineTo(sx, sy - h * 0.005);
	ctx.fill();
	ctx.fillStyle = '#e63946';
	ctx.beginPath();
	ctx.moveTo(sx - w * 0.004, sy - h * 0.085);
	ctx.lineTo(sx - w * 0.035, sy - h * 0.005);
	ctx.lineTo(sx - w * 0.004, sy - h * 0.005);
	ctx.fill();

	// Foreground meadow
	const meadowTop = h * 0.79;
	ctx.fillStyle = '#386641';
	ctx.beginPath();
	ctx.moveTo(0, h);
	for (let x = 0; x <= w; x += w / 60) {
		ctx.lineTo(x, meadowTop + Math.sin((x / w) * 7) * h * 0.02 + Math.sin((x / w) * 19) * h * 0.008);
	}
	ctx.lineTo(w, h);
	ctx.closePath();
	ctx.fill();
	const meadow = ctx.createLinearGradient(0, meadowTop, 0, h);
	meadow.addColorStop(0, 'rgba(106,153,78,0.6)');
	meadow.addColorStop(1, 'rgba(20,50,30,0.5)');
	ctx.fillStyle = meadow;
	ctx.fillRect(0, meadowTop - h * 0.03, w, h);

	// Pines on the left shore
	for (let i = 0; i < 9; i++) {
		const px = w * (0.02 + i * 0.045 + rand() * 0.02);
		const ph = h * (0.12 + rand() * 0.1);
		const base = meadowTop + h * 0.02;
		ctx.fillStyle = i % 2 ? '#1b4332' : '#2d6a4f';
		ctx.beginPath();
		ctx.moveTo(px, base - ph);
		ctx.lineTo(px + ph * 0.28, base);
		ctx.lineTo(px - ph * 0.28, base);
		ctx.fill();
	}

	// Flowers
	const petals = ['#ffb703', '#fb8500', '#e63946', '#f1faee', '#cdb4db', '#ffafcc'];
	for (let i = 0; i < 420; i++) {
		const x = rand() * w;
		const y = meadowTop + h * 0.03 + rand() * (h - meadowTop);
		ctx.fillStyle = petals[Math.floor(rand() * petals.length)];
		ctx.beginPath();
		ctx.arc(x, y, Math.max(1.2, w * (0.003 + rand() * 0.004)), 0, Math.PI * 2);
		ctx.fill();
	}

	// Print grain
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const n = (rand() - 0.5) * 14;
		d[i] = Math.max(0, Math.min(255, d[i] + n));
		d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
		d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
	}
	ctx.putImageData(img, 0, 0);
}
