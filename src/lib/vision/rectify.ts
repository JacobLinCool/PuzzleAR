/**
 * Global foreshortening correction. Every piece's base is a square on the
 * table, so on average the detected base quadrilaterals should be isotropic.
 * A tilted camera squashes them along one direction; the inverse square root of
 * their mean (trace-normalised) second-moment matrix undoes that, to first order.
 */
import type { Pt } from './types';

/** 2x2 linear map [a, b, c, d]: (x, y) -> (a x + b y, c x + d y). */
export type Linear = [number, number, number, number];

export const IDENTITY: Linear = [1, 0, 0, 1];

export function applyLinear(m: Linear, p: Pt): Pt {
	return { x: m[0] * p.x + m[1] * p.y, y: m[2] * p.x + m[3] * p.y };
}

export function invertLinear(m: Linear): Linear {
	const det = m[0] * m[3] - m[1] * m[2];
	return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

/**
 * Estimates the rectifying map from base corners (one quadrilateral per piece).
 * Returns null when the photo is already close to top-down.
 */
export function estimateRectification(quads: Pt[][]): Linear | null {
	const ms: [number, number, number][] = [];
	for (const q of quads) {
		if (q.length !== 4) continue;
		const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
		const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
		let xx = 0,
			yy = 0,
			xy = 0;
		for (const p of q) {
			xx += (p.x - cx) ** 2;
			yy += (p.y - cy) ** 2;
			xy += (p.x - cx) * (p.y - cy);
		}
		const tr = xx + yy;
		if (tr <= 0) continue;
		ms.push([xx / tr, yy / tr, xy / tr]);
	}
	if (ms.length < 4) return null;
	// median per component is robust to the odd mis-detected piece
	const med = (k: number) => {
		const v = ms.map((m) => m[k]).sort((a, b) => a - b);
		return v[Math.floor(v.length / 2)];
	};
	const a = med(0),
		d = med(1),
		b = med(2);
	// eigen-decomposition of the symmetric matrix [[a, b], [b, d]]
	const tr = a + d;
	const det = a * d - b * b;
	const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
	const l1 = tr / 2 + disc;
	const l2 = tr / 2 - disc;
	if (l2 <= 0 || l1 / l2 < 1.12) return null;
	const theta = 0.5 * Math.atan2(2 * b, a - d);
	const c = Math.cos(theta),
		s = Math.sin(theta);
	// M^(-1/2) = R diag(1/sqrt(l1), 1/sqrt(l2)) R^T, scaled to keep area (det = 1)
	const k1 = 1 / Math.sqrt(l1),
		k2 = 1 / Math.sqrt(l2);
	const norm = 1 / Math.sqrt(k1 * k2);
	return [
		(c * c * k1 + s * s * k2) * norm,
		c * s * (k1 - k2) * norm,
		c * s * (k1 - k2) * norm,
		(s * s * k1 + c * c * k2) * norm
	];
}
