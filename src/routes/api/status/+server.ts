import type { RequestHandler } from './$types';
import { env, json } from '$lib/server/http';

export const GET: RequestHandler = async (event) => json({ scannerAvailable: Boolean(env(event).MODEL_API_KEY) });
