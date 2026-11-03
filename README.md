# PuzzleAR

**See the pieces. Find the fit. Finish it together.**

PuzzleAR turns one photo of scattered jigsaw pieces into step-by-step guidance for assembling the real puzzle on your table. Meta SAM 3.1 outlines every piece; a deterministic shape-and-color solver proposes where each one goes; the app then points at the physical piece to pick up, shows where it belongs, and checks each placement with a new photo or your confirmation. No box image and no account are needed.

Live: **https://puzzlear.jacob.workers.dev** · Demo video: [`video/out/puzzlear-demo.mp4`](video/out/puzzlear-demo.mp4)

## How it works

| Step | What happens | Where it runs |
|---|---|---|
| Scan | The photo is normalized on the device (EXIF rotation, longest edge 2048 px, metadata dropped), stored privately in R2, and sent to Meta SAM 3.1 with the concept prompt `jigsaw puzzle piece`. The Worker streams SAM's SSE response straight to the browser, which parses it with `@meta-sam/parser`, so outlines appear as they arrive. | Cloudflare Worker → Meta API → browser |
| Review | Each mask becomes an app piece with a stable UUID. Pieces that look wrong (too small or large, cut off, overlapping, unsure) are flagged with a concrete fix: add a piece by tap or box, re-scan a mask with points, drag the four base corners, override side types, remove, undo. | Browser (+ SAM refine calls) |
| Match | Contours are traced, four base corners found, and every side classified as flat, tab or socket. Compatible side pairs are ranked by shape misfit after alignment, color continuity along the cut, and length. A constrained beam search fills the grid and returns up to three distinct boards. | Web Worker in the browser |
| Assemble | The next piece is chosen to grow the assembled region from a corner. With a marked assembly area, a homography projects a ghost of the real piece texture into the photo or live camera view. A check photo is compared against the first one: the source spot must be empty and the piece's pattern must appear in the target cell. Anything short of both is left for the person to confirm. | Web Worker in the browser |

The solver never claims certainty it does not have. Edge scores are ranking costs, not probabilities, so the UI labels edges as **Strong candidate**, **Needs a check**, or **Human-confirmed**. "Fits" and "Doesn't fit" answers become hard constraints, and confirmed placements are pinned, so every re-solve keeps them.

## Architecture

The PRD sketches a Docker deployment with a Python/OpenCV service. This build keeps the product behavior and data contracts but moves the computer vision into the browser so that the whole app runs on Cloudflare's free tier:

- **SvelteKit 3 on Cloudflare Workers** (`@sveltejs/adapter-cloudflare`) serves the UI and the same-origin API.
- **D1** stores sessions (one validated workspace document per session with an optimistic revision), media records, every SAM request (for rate limits, caching, and audit), and daily spend.
- **R2** stores photos and raw SAM responses privately; a lifecycle rule expires `sessions/` objects after one day.
- **Vision and solver** are plain TypeScript (`src/lib/vision`) running in a Web Worker. Nothing heavy runs on the Worker, which only validates, stores, and pipes streams, so it stays within the free plan's CPU budget.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data flow, API, and the mapping from PRD requirements to this implementation.

## Cost

Hosting fits Cloudflare's free tier (Workers, D1, R2, static assets). The only metered cost is Meta SAM 3.1 at about US$0.0025 per image request. Each session may make 15 SAM requests per hour, each IP 60, and the Worker refuses new requests once the daily budget (`META_DAILY_BUDGET_USD`, default US$25) is reached. Repeating an identical request is served from the stored response instead of being billed again. The sample session replays a stored real response and costs nothing until someone presses **Run with Meta API**.

## Privacy

Photos go to Meta's API only when you scan, and the app says so before capture. Sessions are anonymous and readable only by the browser holding the session cookie (the URL alone is not enough). Everything is deleted 24 hours after a session starts, or immediately with **Delete session**. Photos taken to check a placement are compared in the browser and never uploaded.

## Run it

Requirements: Node 22+, pnpm, a Cloudflare account, and a Meta SAM API key.

```sh
pnpm install
cp .dev.vars.example .dev.vars          # add MODEL_API_KEY
pnpm exec wrangler d1 migrations apply puzzlear --local
pnpm build && pnpm preview              # http://localhost:4173
```

Deploy (after creating the D1 database and R2 bucket named in `wrangler.jsonc`):

```sh
pnpm exec wrangler secret put MODEL_API_KEY
pnpm exec wrangler r2 bucket lifecycle add puzzlear-sessions retention-24h sessions/ --expire-days 1
pnpm deploy
```

Without `MODEL_API_KEY` the sample session still works and live scanning reports that the scanner is unavailable; it never falls back to fake results.

## Tests

```sh
pnpm test:unit -- --run   # vision, solver, verification, upload checks, document validation
pnpm test:e2e             # full sample flow on desktop and mobile viewports, privacy checks
pnpm check                # types
```

The vision tests run on synthetic puzzles with known ground truth (`pnpm fixtures` regenerates them) and on stored real SAM 3.1 responses for those photos. Corners, side types, the top-ranked board and its upright orientation are checked against ground truth, and placement checks must accept a correctly placed piece and reject one in the wrong cell.

## Known limits

- Tested grids run from 3×3 to 4×6. Pieces SAM misses can be added by tap or box.
- The fixtures are synthetic. `hard-4x6` imitates a phone photo (tilted camera, rounded cuts, uneven tabs, wood table, lower resolution); glossy finishes, near-uniform colors or touching pieces will still need review corrections, which the app surfaces rather than hides.
- Solving a board needs every piece of a rectangular grid. For a partial pile the app switches to **Likely neighbours**: edges where both sides pick each other, ranked, to try on the table.
- Photos taken at a steep angle are corrected for foreshortening from the pieces themselves (every base is a square); extreme angles still flag more pieces for review.
- Placement checks assume a fixed camera. If the framing changes, the check reports that the camera moved and asks you to recalibrate or confirm by hand.
- Without a box image every turn of the board is equally valid. The app starts with the turn that looks upright (lighter, bluer edges at the top) and offers **Turn board**.

## Repository

```
src/lib/vision/      contour, corners, edges, matching, solver, homography, verification (+ tests)
src/lib/sam/         SSE parsing and mask decoding around @meta-sam/parser
src/lib/server/      sessions, uploads, Meta SAM bridge, rate and budget guards
src/lib/client/      workspace store, worker client, rendering, segmentation, simulation
src/routes/          pages (/, /new, /p/[id]/{review,solve,guide,done}, /privacy) and /api
tools/               synthetic fixture generator, sample builder, SAM spike
fixtures/            synthetic puzzles with ground truth and real SAM responses
video/               demo video sources
```
