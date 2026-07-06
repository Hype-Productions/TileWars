# Pattern Tiles Instructions

Quick notes for running and trying the game after cloning the repo.

## Run It

From the repo folder:

```bash
npm install
npm run build
```

For normal local checks:

```bash
npm run test
npm run type-check
npm run lint
```

To playtest through Devvit:

```bash
npm run login
npm run dev
```

`npm run login` is only needed if you are not already logged into Devvit.

## Starting A Game

The first screen has two main options:

- **Daily** starts the daily puzzle generated from the current UTC date.
- **Custom** opens testing options.

Custom has two options:

- **Random seed** starts a seeded puzzle with a random number. This is for unlimited non-daily play.
- **Pick pattern** lets you choose the hidden pattern on a mini 5x5 grid before starting.

If you pick the pattern manually, it must have 4-7 tiles and be connected. Connected means every selected tile touches the pattern through horizontal, vertical, or diagonal contact. The game will block invalid patterns.

After the game starts, the chosen pattern is hidden so you can play without spoilers.

## Goal

Find every tile in the hidden pattern.

The board is 5x5. The hidden pattern has 4-7 tiles. The remaining counter shows how many pattern tiles are still unfound.

## Clue Colors

When you click a tile, it can show one or more clue colors:

- **Green**: this tile is part of the hidden pattern.
- **Red**: at least one pattern tile is in the same vertical column.
- **Blue**: at least one pattern tile is in the same horizontal row.
- **Orange**: at least one pattern tile is diagonal from this tile.

If a clicked tile is green, it can still show smaller red, blue, or orange clue colors inside the green tile.

Already-found pattern tiles still count as clue sources for later guesses.

## Buttons And Modes

- **Balanced**: mixed clue colors get equal space on the tile.
- **Proximity**: closer clue sources take more visual space on the tile.
- **X mode**: mark tiles you think are not part of the pattern. X marks are just visual notes and do not count as guesses.
- **New / New game**: return to the first screen.

The puzzle is solved when the remaining counter reaches zero.
