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

For a browser-only UI preview after building:

```bash
python -m http.server 5173 --directory dist/client
```

Then open `http://127.0.0.1:5173/game.html`. Daily persistence and real Versus
matchmaking are not available in this static preview.

To playtest through Devvit:

```bash
npm run login
npm run dev -- TileFinder
```

`npm run login` is only needed if you are not already logged into Devvit.

## Starting A Game

The first screen has three main options:

- **Daily** starts the daily puzzle generated from the current UTC date.
- **Versus** opens asynchronous player matches.
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

## Versus

Versus needs the Reddit playtest version because matchmaking, hidden patterns, and
scores are stored in Devvit Redis. A plain local preview can be used to review the
landing screen and six-tile pattern picker, but it cannot create a real opponent.

The Versus hub shows your level, XP progress, Daily streak, overall record, and
matches grouped into **Your Turn**, **Waiting**, and **Results**.

To start a public match, press **Find Match**, select exactly 6 connected tiles,
and submit. If another pattern is waiting, their board opens immediately.
Otherwise the search continues after you leave. One search creates one match.

**Invite** lets you submit a pattern and share a Reddit invitation link. The first
other player to open the invitation submits their own pattern and starts a direct
match.

You solve the opponent's pattern while they solve yours. The clock in the top-right
shows elapsed solve time. The server keeps the official time. Fewest guesses wins;
elapsed time breaks a tie.

Once you finish, the opponent can see your score and replay grid. When both players
finish, **Results** shows both grids and the winner. **Rematch** lets one player
submit a new pattern as an invitation; the other player submits their pattern to
accept it.

Wins give 100 XP, draws give 70 XP, and completed losses give 40 XP. Daily puzzles
start at 150 XP and gain 15 XP per consecutive UTC-day streak, up to 300 XP. A
missed Daily resets the next solved puzzle to a one-day streak. Dev reset can replay
the puzzle for testing but cannot award its XP twice.
