# Architecture

## Why the platform differs from the PRD

The PRD (v1.0) specifies SvelteKit on Node, a Python/OpenCV service, SQLite, and a disk volume. The brief for this build added one constraint: host on Cloudflare at close to zero cost. Cloudflare's free Workers plan allows about 10 ms of CPU per request, which rules out server-side image processing but leaves plenty of room for validation, storage and streaming. The browser, by contrast, has idle CPU and already holds the photo. So the product behavior and contracts stay as specified while the work moves:

| PRD component | This build |
|---|---|
| SvelteKit `adapter-node` | SvelteKit 3 `adapter-cloudflare` on Workers with static assets |
| FastAPI + OpenCV + NumPy solver | TypeScript in `src/lib/vision`, run in a Web Worker |
| SQLite + Drizzle | D1 (SQLite) with plain prepared statements |
| `/data/sessions` volume | Private R2 bucket, served only through cookie-checked routes |
| In-process job queue + SSE progress | The Worker pipes Meta's SSE stream to the browser; progress is real parser progress |
| Hourly cleanup cron | R2 lifecycle rule (1 day) + expired rows deleted on access and on session creation |

## Data flow

```
camera / upload
  → normalize on device (EXIF rotation, ≤2048 px, re-encode JPEG, metadata dropped)
  → POST /api/sessions/:id/media        magic bytes, size and pixel limits, APPn stripped, R2 put
  → POST /api/sessions/:id/segment      guards → base64 from R2 → Meta /v1/responses (stream)
        ├─ tee → browser: @meta-sam/parser → masks (ROI at box bounds) → app pieces (UUID)
        └─ tee → R2 copy + D1 status (cache for identical retries)
  → Web Worker: contour → corners → sides → match table → beam search → top-3 boards
  → PUT /api/sessions/:id (revision)    validated workspace document
  → guide: next step, homography ghost, check photo → verify in Web Worker → confirm
  → export: solution.json (server), assembled.png (browser)
```

## Session and document model

A session row holds a SHA-256 of a random secret (the cookie), its state, a revision counter and a JSON workspace document (`src/lib/shared/doc.ts`). The document carries pieces with their masks (row-major run lengths), constraints, solutions, placements and an undo/redo history of snapshots. Every write sends the revision it was based on; a stale write gets `409 SESSION_CHANGED` and the client reloads instead of overwriting. The server runs `validateDoc` on every write: legal state transitions, a segmented photo before review, a covering solution before guiding, every piece placed before completion, piece ids never deleted, and constraints referring to known pieces.

## API

All routes are same-origin and authorized by the `pz_<id>` httpOnly cookie. Errors use `{ error: { code, message, retryable, action }, requestId }`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/sessions` | Create an anonymous session (`mode`: camera, upload, demo) |
| GET | `/api/sessions/:id` | Session, document and scanner availability |
| PUT | `/api/sessions/:id` | Store a new document version (`revision`, optional `history: undo|redo`) |
| DELETE | `/api/sessions/:id` | Delete R2 objects and rows |
| POST | `/api/sessions/:id/media?kind=` | Upload a photo |
| GET | `/api/sessions/:id/media/:mid` | Private photo (no-store) |
| POST | `/api/sessions/:id/segment` | SAM concept segmentation, streamed |
| POST | `/api/sessions/:id/refine` | SAM box/point refinement (≤16 objects, built with `buildObjectPrompt`) |
| GET | `/api/sessions/:id/export?format=json` | `solution.json` |
| GET | `/api/status`, `/healthz` | Scanner availability; D1 read/write health |

SAM guard order: cache hit → one running request per session → 15 per session per hour → 60 per IP per hour → daily budget. Upstream 429 is retried with `Retry-After` or 0.5/1/2 s backoff; 400 is not retried; 401/403/404 report a configuration problem.

## Vision pipeline

- **Mask** (`mask.ts`): largest component, holes filled; area, border, overlap and confidence checks become review flags rather than silent drops.
- **Camera tilt** (`rectify.ts`, `analyze.ts`): a first pass finds every piece's base quadrilateral; since each base is a square on the table, their mean second-moment matrix reveals foreshortening, and a second pass measures all geometry on corrected contours while colours are still read from the photo.
- **Contour** (`contour.ts`): Moore-neighbour tracing, clockwise, smoothed and resampled to 1.5 px.
- **Corners** (`body.ts`, `corners.ts`): two estimates. The body fit erodes the mask until the tabs detach on their necks, keeps the main body, dilates it back, fits a line to each of its four sides and intersects them, which holds up for four-tab pieces and tilted cameras. The local detector scores contour points by straight, near-perpendicular arms. Each estimate is turned into four sides and the more self-consistent one wins (similar side lengths, near-right angles, every side readable). Poor fits are flagged for manual corner editing.
- **Sides** (`edges.ts`): 128 samples per side, measured from a baseline through the straight shoulders at both ends (rounded die-cut corners would bias a corner-to-corner chord). Flat when the side barely leaves the baseline; otherwise one-sided excursions or the sign of the area between side and baseline decide tab versus socket. A Lab color strip is sampled 3–7 px inside the cut.
- **Matching** (`match.ts`): only tab↔socket (or unknown) pairs; shape misfit after scaling both sides to unit length (pieces far from and near to a tilted camera appear at different sizes) and a few rigid ICP steps, mean CIE76 color difference along the mirrored strips, and relative length difference with a tolerance for perspective. Shape and color are normalised by their medians; weights 0.55/0.30/0.15 as in the PRD. `tools/eval.ts` and `tools/eval-match.ts` report corner error, side mistakes, true-partner rank and board accuracy per fixture.
- **Solver** (`solver.ts`): row-major constrained beam search (width 384, 8 s budget) with border rules, locks, forbidden pairs and pins; pairwise swap improvement; canonical de-duplication of rotated boards; a relaxed pass with penalties before reporting `NO_FEASIBLE_SOLUTION`. Edge confidence is `strong` only for mutual best matches with a clear margin.
- **Orientation** (`orient.ts`): picks the board turn whose top row is lighter and bluer than its bottom row.
- **Verification** (`verify.ts`): camera-movement check on static background, source-vacated check against the first photo, and a small pose search for the best NCC of the piece's own pixels warped through the board homography. `verified` requires both signals; anything else asks the person.

## PRD coverage

| PRD | Status |
|---|---|
| FR-01 camera / upload | Done; camera only after the person asks, upload always available |
| FR-02 server-side SAM | Done; live calls logged with provider request id and object count |
| FR-03 stable piece ids | Done; app UUIDs, never deleted, versioned masks |
| FR-04 review repair | Done; add by tap/box, re-scan mask, edit corners, side types, remove, reset, undo |
| FR-05 geometry | Done; tested against ground truth |
| FR-06 solve + alternatives | Done; up to three distinct boards. Partial piles get a ranked list of likely neighbours (PRD's acceptable partial success) |
| FR-07 human constraints | Done; fits/doesn't fit and confirmed placements always respected |
| FR-08 physical guidance | Done; photo highlight, cell target, homography ghost, live camera overlay |
| FR-09 verify or confirm | Done; three outcomes, low confidence never auto-completes |
| FR-10 session/export/delete | Done; refresh restores, PNG + JSON export, delete makes photos unreadable |
| FR-11 demo/deployment | Done; HTTPS on workers.dev, preprocessed sample plus live Meta run |
| FR-12 video tracking (P1) | Not built |

## Deploy

Create the D1 database and R2 bucket named in `wrangler.jsonc`, then:

```sh
pnpm exec wrangler secret put MODEL_API_KEY
pnpm exec wrangler r2 bucket lifecycle add puzzlear-sessions retention-24h sessions/ --expire-days 1
pnpm deploy
```

Without `MODEL_API_KEY` the sample session still works and live scanning reports that the scanner is unavailable; it never falls back to fake results.

## Cost

Hosting fits Cloudflare's free tier (Workers, D1, R2, static assets). The metered cost is Meta SAM 3.1 at about US$0.0025 per image request. Each session may make 15 SAM requests per hour and each IP 60, and the Worker refuses new requests once the daily budget (`META_DAILY_BUDGET_USD`, default US$25) is reached. An identical repeated request is served from the stored response instead of being billed again.

## Privacy

Photos are resized on the device before upload, which drops location and camera metadata; the Worker also strips JPEG metadata segments. Photos and raw SAM responses are stored privately in R2 and served only to the browser holding the session cookie (`no-store`). Sessions expire after 24 hours and can be deleted at once. Check photos taken during assembly are compared in the browser and never uploaded.
