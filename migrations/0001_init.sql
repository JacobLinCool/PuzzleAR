-- Sessions are anonymous. The id appears in URLs; reading requires the secret
-- held in an httpOnly cookie, stored here only as a SHA-256 hash.
CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	secret_hash TEXT NOT NULL,
	mode TEXT NOT NULL CHECK (mode IN ('camera', 'upload', 'demo')),
	state TEXT NOT NULL,
	revision INTEGER NOT NULL DEFAULT 0,
	-- workspace document: pieces, masks, constraints, solutions, placements, history
	doc TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE media (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('initial', 'verification')),
	r2_key TEXT NOT NULL,
	mime TEXT NOT NULL,
	width INTEGER NOT NULL,
	height INTEGER NOT NULL,
	bytes INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX media_session ON media (session_id);

-- Every Meta SAM call, for rate limits, the daily budget, caching and audit.
CREATE TABLE sam_requests (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	media_id TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('segment', 'refine')),
	cache_key TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
	r2_key TEXT,
	objects INTEGER,
	provider_request_id TEXT,
	error_code TEXT,
	ip_hash TEXT NOT NULL,
	cost_usd REAL NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX sam_requests_session ON sam_requests (session_id, created_at);
CREATE INDEX sam_requests_cache ON sam_requests (session_id, cache_key);
CREATE INDEX sam_requests_ip ON sam_requests (ip_hash, created_at);

-- Daily spend survives session deletion so the budget cannot be reset by deleting.
CREATE TABLE usage_daily (
	day TEXT PRIMARY KEY,
	requests INTEGER NOT NULL DEFAULT 0,
	cost_usd REAL NOT NULL DEFAULT 0
);
