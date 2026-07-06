# Pattern Tiles

A daily Reddit game built with Devvit Web and Phaser. Players search a 5x5 board for a linked hidden pattern using row, column, diagonal, and exact-hit clues.

## Game Rules

- The hidden pattern has 4-7 tiles.
- Every pattern tile must touch another pattern tile horizontally, vertically, or diagonally.
- Picking a tile gives any clue colors that apply:
  - Green: the picked tile is part of the pattern.
  - Red: a pattern tile is in the same column.
  - Blue: a pattern tile is in the same row.
  - Orange: a pattern tile is on a diagonal.
- Found pattern tiles still count as clue sources for later guesses.
- X mode marks tiles visually without spending a guess.
- The remaining counter tracks unfound pattern tiles.

## Daily And Test Modes

- Daily generation is deterministic from the UTC date and a seed.
- The dev panel can generate from a seed, load an exact pattern like `A1,B2,C3,D4`, and switch between balanced and proximity clue rendering.
- The project does not use Redis, payments, realtime services, AI services, or third-party backends.

## Commands

- `npm run test`: Run puzzle logic tests.
- `npm run type-check`: Check TypeScript.
- `npm run lint`: Run ESLint.
- `npm run build`: Build the Devvit client and server bundles.
- `npm run login`: Log the Devvit CLI into Reddit.
- `npm run dev`: Run Devvit playtest on Reddit.

## Publishing

Open this folder in GitHub Desktop, commit the files, and publish the repository to the target GitHub organization. For Reddit playtesting, log in with `npm run login`, then use `npm run dev`.
