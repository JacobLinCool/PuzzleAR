import type { RequestHandler } from './$types';
import { env, json } from '$lib/server/http';

/** Liveness plus a D1 read/write round trip. */
export const GET: RequestHandler = async (event) => {
	const e = env(event);
	try {
		await e.DB.prepare(
			"INSERT INTO usage_daily (day, requests, cost_usd) VALUES ('healthz', 0, 0) ON CONFLICT(day) DO UPDATE SET requests = 0"
		).run();
		await e.DB.prepare("SELECT day FROM usage_daily WHERE day = 'healthz'").first();
		return json({ ok: true, db: 'ok', scanner: Boolean(e.MODEL_API_KEY) ? 'configured' : 'unavailable' });
	} catch (err) {
		return json({ ok: false, db: String(err) }, { status: 503 });
	}
};
