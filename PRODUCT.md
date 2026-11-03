# PuzzleAR — product context

Source of truth: `PuzzleAR_PRD_v1.0.md` (hackathon PRD, 2026-11-03). This file keeps the parts that guide design decisions.

## What it is
A physical-jigsaw assistant. A person photographs the loose pieces on their table; Meta SAM 3.1 segments every piece; a deterministic shape-and-color solver proposes where each piece goes; the app then guides the person, one real piece at a time, and checks each placement with a new photo or the person's own confirmation.

Promise: **See the pieces. Find the fit. Finish it together.** It is not a virtual puzzle game and never "plays it for you".

## Who uses it
- Casual puzzlers finishing a small puzzle in 10–30 minutes at a table, phone in one hand, pieces in the other.
- Enthusiasts who want to see the evidence (edge shapes, scores) and correct it.
- Hackathon judges with no puzzle at hand: the sample session must show the whole flow in under two minutes.

## Use scene
Daytime or lamp-lit kitchen/dining table, phone or laptop propped above the table, hands busy. Light UI on a warm ground; large touch targets; nothing that needs reading while a piece is in hand.

## Honesty rules (product truth)
- Never show fake progress percentages or fake live segmentation.
- Solver scores are ranking costs, not probabilities. Use "Strong candidate", "Needs a check", "Human-confirmed".
- Low confidence never marks a step done; the person confirms.
- The sample session is labelled "Sample session · Preprocessed example" and offers a real Meta API run.
- Photos are sent to Meta's API; say so before capture. Sessions expire after 24 hours and can be deleted at once.

## Brand commitments (pinned by the PRD)
- A premium handmade worktable and paper puzzle, not an analytics dashboard.
- Warm ivory ground `#F7F5F0`, white surfaces, ink `#24312D`, muted `#6A7770`, deep teal action `#167A6B` (hover `#116454`), amber hint `#B97720`, error `#B74444`, verified `#247B56`, border `#E5E6DF`.
- Inter; radius 16 (large) / 10 (controls); 4px spacing base; 44px touch targets.
- No heavy gradients, no glassmorphism, no glowing AI effects. State is never color alone.
- English UI.

## Surfaces and modes
- Landing `/`: Persuade.
- Capture, Review, Solver Studio, Assembly Guide, Completion: Operate.
- Privacy: Read.
