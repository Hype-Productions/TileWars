# TILEWARS

> A small daily logic game about finding connected patterns on a colorful grid.

TILEWARS is a Devvit Web app built with Phaser 4 that runs inside Reddit Interactive Posts. Each day, players receive the same 5x5 board and search for a hidden connected pattern of 4-7 tiles. The board gives directional and exact-hit clues, so solving it is about reading the information and narrowing the possibilities rather than guessing blindly.

The basic loop is simple: solve today's puzzle, compare your result with the community, challenge another player, and come back for the next daily board.

## What Keeps It Interesting

The game is built around three connected parts:

- **A daily mystery:** the same deterministic puzzle is available to everyone for one UTC day, creating a shared conversation and a fair leaderboard.
- **A satisfying deduction:** every guess reveals structured information about rows, columns, diagonals, or exact pattern tiles. Good players are rewarded for reasoning, not luck.
- **A social rematch loop:** players can compete asynchronously through public matchmaking, invitation links, five-character invite codes, and rematch requests.

The first puzzle is quick to understand, while better clue reading can improve results over time.

## How To Play

1. Open a TILEWARS post and choose **Daily Puzzle**.
2. Inspect the 5x5 board. The hidden answer is a connected group of 4-7 tiles.
3. Tap a tile to make a guess. The tile reveals every clue that applies to it.
4. Use the clue colors to eliminate impossible locations and find the full pattern.
5. Finish the pattern with as few guesses as possible and check your rank.

The hidden pattern is always connected horizontally, vertically, or diagonally. A guess can reveal several clues at once:

| Color | Meaning |
| --- | --- |
| Green | This tile is part of the hidden pattern. |
| Red | A pattern tile is in the same column. |
| Blue | A pattern tile is in the same row. |
| Orange | A pattern tile is on a diagonal. |

Multicolored tiles show a combination of clues. Found green tiles stay green and use a small inset clue window when other directional clues also apply, so the pattern remains visually distinct without hiding useful information.

Players can use **X** marks as free notes. An X never costs a guess and is saved with the session. The game also includes a compact clue guide, responsive mobile and desktop layouts, animated tile feedback, and a clear pattern-complete reveal before the result screen.

## Multiplayer

### 1v1 Match

TILEWARS is asynchronous by design. Players do not need to be online at the same time.

1. Submit a connected hidden pattern for your opponent.
2. Solve the opponent's pattern using the same clue system as the Daily Puzzle.
3. Compare guesses first and server-measured solve time second.
4. Review both boards, see the head-to-head result, and send a rematch invitation.

Players can connect through:

- Public matchmaking.
- Reddit invitation links.
- Five-character invitation codes.
- Rematch invitations from completed results.

The Versus lobby keeps active matches, invitations, completed results, rival records, and opponent history in one place. A match can be played at the player's pace, while unfinished public games are limited so the lobby stays manageable.

## Reddit-Native Community Loop

The game stays inside the Reddit post and uses a few features that fit naturally around the puzzle:

- The game runs directly inside a Reddit post on desktop and mobile.
- Daily results feed a shared community leaderboard with player ranks and compact rank gaps.
- Players can post their result as a comment on the subreddit game post.
- Daily streaks, persistent XP, and uncapped level progression give regular players a reason to return beyond a single score.
- Versus results create rivalry history, win/loss/draw records, replayable match boards, and rematch opportunities.

### Titles And Flairs

XP and levels provide the progression foundation for subreddit-native identity rewards. The intended community layer is to turn milestone levels into recognizable titles, colored flairs, and seasonal status that players can show beside their Reddit identity. The current release focuses on the gameplay, levels, XP, leaderboards, result comments, and rivalry data; automated title and flair rewards can be added as a moderation-facing expansion without changing the puzzle loop.

This would give a subreddit a lightweight way to recognize regular players without making the core puzzle harder to approach.

## Technical Overview

The app keeps puzzle validation, clue calculation, leaderboard scoring, match settlement, XP awards, and marker persistence server-authoritative. It does not depend on external paid services, third-party hosting, or AI services.

- **App platform:** Devvit Web and Reddit Interactive Posts.
- **Frontend:** Phaser 4, TypeScript, and Vite.
- **Backend:** Devvit serverless runtime with Hono.
- **Persistence:** Devvit Redis through `@devvit/web/server`.
- **Testing:** Vitest, TypeScript build checks, ESLint, and production builds.

## Project Structure

- `src/client/splash.ts` and `src/client/splash.html`: lightweight Reddit post landing screen.
- `src/client/scenes/PatternGame.ts`: Daily gameplay, clues, markers, results, and progression presentation.
- `src/client/scenes/VersusLobby.ts`: matchmaking, invitations, history, rematches, and rewards.
- `src/client/scenes/VersusGame.ts`: server-backed opponent puzzle gameplay.
- `src/client/scenes/VersusResult.ts`: replay comparison and head-to-head results.
- `src/client/scenes/tileWarsTheme.ts`: shared TILEWARS visual system and Phaser UI primitives.
- `src/server/core`: Redis-backed Daily, Versus, progression, and Reddit storage.
- `src/shared`: pure puzzle, session, progression, marker, and Versus rules.
- `tests`: focused tests for puzzle logic, sessions, progression, markers, and Versus rules.
