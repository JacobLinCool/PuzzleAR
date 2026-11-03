# Evaluation

## Test puzzles

Four rendered puzzles with known solutions live in `fixtures/` (`pnpm fixtures` regenerates them). Each was segmented once by the live Meta SAM 3.1 API and the response is stored, so tests replay real model output without network calls.

| Fixture | Pieces | Capture |
|---|---|---|
| `sample-3x3`, `sample-3x4`, `sample-4x4` | 9, 12, 16 | Top-down, sharp die cuts, uniform tabs, felt mat |
| `hard-4x6` | 24 | Phone-style: camera tilted (keystone), rounded cuts, tabs varying ±30%, wood table, light cut edges, 1448 px wide |

## Results with SAM 3.1 outlines

| Fixture | Corner error (median / max, share of piece side) | Side types wrong | Pieces flagged for review | Correct board rank | Cells right in top board |
|---|---|---|---|---|---|
| `sample-3x3` | 0.019 / 0.025 | 0 | 0 | 1st | 9 / 9 |
| `sample-3x4` | 0.021 / 0.025 | 0 | 0 | 1st | 12 / 12 |
| `sample-4x4` | 0.021 / 0.054 | 0 | 0 | 1st | 16 / 16 |
| `hard-4x6` | 0.039 / 0.118 | 0 | 0 | 1st | 24 / 24 |

Edge by edge, the true partner is the single best local match for 26 of 38 adjacencies in `hard-4x6` (33 within the top three); the board search recovers the rest. In the likely-pairs list used for partial piles, every pair marked strong was a true neighbour (15 of 15 in `hard-4x6`, 14 of 14 in `sample-4x4`).

Placement checks accept a piece placed in its cell (pattern match 0.98) and reject the same piece placed in the wrong cell (0.16).

`pnpm tsx tools/eval.ts <fixture>` and `pnpm tsx tools/eval-match.ts <fixture>` reproduce these numbers; the unit tests assert them.

## A real photo

One user photo (27 pieces from a larger puzzle, shot at roughly 45°, thick pieces with visible cut edges) has no ground truth. After foreshortening correction, 4 of 27 pieces were flagged for review and one side of one piece was left unclassified. The pieces do not form a complete rectangle, so the app offered likely pairs: 2 strong and 12 worth a try. Whether those pairs are right needs a check on the table.

## Known limits

- Tested sizes run from 9 to 24 pieces. Larger puzzles have not been measured.
- Solving a board needs every piece of a rectangular grid; a partial pile gets likely pairs instead.
- Pieces already joined into a block are outlined one by one by SAM and then flagged; assembled regions are not recognised as such.
- Near-uniform areas (open sky) leave colour with little to say, so those fits rest on shape alone.
- Placement checks assume the camera stays where it was for the first photo.
- Without a box image every turn of a board is equally valid; the app starts with the turn whose top looks lighter and bluer, and offers **Turn board**.
