# PuzzleAR

**Find your next piece. Keep the joy of puzzling.**

PuzzleAR turns a photo of your scattered pieces into step-by-step help, without the box image.

**Try it:** https://puzzlear.jacob.workers.dev · **Demo video:** https://youtu.be/476nt5J34ro

## The moment it helps

You want the satisfaction of finishing a puzzle yourself, yet you keep searching the same pile of pieces. PuzzleAR finds your next step when you need it and leaves the fun part, putting it together, to you.

## Three steps

1. **Snap a photo.** Spread the pieces out and take one photo from above. Every piece gets a number you can spot on the table.
2. **Find your next piece.** PuzzleAR suggests which piece to pick up next and which pieces it joins.
3. **Place it with guidance.** See where it goes, drawn right on the photo of your table. Check the move with a new photo, or confirm it yourself.

You stay in control throughout: inspect a suggested fit, confirm what works, and PuzzleAR updates the next steps around your answers. Any step can be undone.

## How Meta SAM 3.1 makes it work

Meta SAM 3.1 helps PuzzleAR see individual pieces. Our matching engine turns those outlines into possible fits, and visual guidance helps you act on them. Without per-piece outlines from a single photo, the rest of the experience would need a scanner or the box image.

## Result

In our tests, a phone-style photo of 24 scattered pieces, shot at an angle, came back as the right picture, cell for cell, from Meta SAM 3.1's outlines. That photo is a rendered test puzzle; the setup and the other results are in the [evaluation](docs/EVALUATION.md).

The tested sizes are small puzzles of up to two dozen pieces. A partial pile cannot be solved into a full board, so PuzzleAR then lists the pairs of pieces most likely to fit together instead.

## Try it

- **Sample puzzle:** open the site and choose **Try Sample Puzzle**. The sample replays a stored real Meta SAM 3.1 response for a rendered photo; **Run with Meta API** scans it live.
- **Your own puzzle:** choose **Scan My Puzzle**, then take or upload a photo with the pieces apart and face up.

No account is needed. Photos are private to your browser session and deleted within a day, or right away from the finish screen or the privacy page.

## Meta integration

The server sends the photo to Meta SAM 3.1 (`sam-3.1`, Responses API) with the concept prompt `jigsaw puzzle piece` and streams the answer straight to the browser, where `@meta-sam/parser` turns it into piece outlines as they arrive. Pieces the scan misses can be added with a tap or a box, which calls SAM 3.1 with point and box prompts built by `buildObjectPrompt`.

## Built during the event

Everything in this repository was built for the Meta Global AI Developer Hackathon: the web app, the piece analysis and matching engine, the guided assembly with photo checks, the synthetic test puzzles and the demo video.

## Develop

```sh
pnpm install
cp .dev.vars.example .dev.vars          # add MODEL_API_KEY
pnpm exec wrangler d1 migrations apply puzzlear --local
pnpm build && pnpm preview              # http://localhost:4173
pnpm test:unit -- --run && pnpm test:e2e && pnpm check
```

Deploying, architecture and API: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Accuracy, test setup and limits: [`docs/EVALUATION.md`](docs/EVALUATION.md).
