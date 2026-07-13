You are writing a Devvit Web application that runs inside Reddit posts.

## Tech Stack

- **Frontend**: Phaser 4, Vite
- **Backend**: Devvit Web serverless runtime, Node.js v22, Hono
- **Persistence**: Devvit Redis via `@devvit/web/server`
- **Testing**: Vitest

## Layout & Architecture

- `/src/client`: Frontend code executed inside the Reddit iframe.
  - `game.html` / `game.ts`: Expanded playable Phaser game.
  - `splash.html` / `splash.ts`: Lightweight inline feed view.
  - `scenes/PatternGame.ts`: Main Phaser scene and UI.
  - `scenes/VersusLobby.ts`: Social hub, pattern submission, matchmaking, invitations, rewards, and match lists.
  - `scenes/VersusGame.ts`: Server-backed timed Versus board.
  - `scenes/VersusResult.ts`: Head-to-head score and replay comparison.
  - `versusClient.ts`: Typed client wrappers for Versus server APIs.
- `/src/server`: Backend code executed in Devvit's serverless environment.
  - `index.ts`: Hono app entry point.
  - `routes/api.ts`: Daily session, guess, marker, mode, leaderboard, and dev reset APIs.
  - `routes/versus.ts`: Versus lobby, matchmaking, invitation, session, guess, marker, mode, and rematch APIs.
  - `routes/progress.ts`: Shared XP profile and reward acknowledgement APIs.
  - `routes/menu.ts`: Devvit menu action endpoints.
  - `routes/triggers.ts`: Devvit trigger endpoints.
  - `core/dailyStorage.ts`: Redis key naming and persistence helpers.
  - `core/versusStorage.ts`: Versus searches, invitations, matches, attempts, rematches, and settlement.
  - `core/progressStorage.ts`: Idempotent XP awards, Daily streaks, overall records, rewards, and rivalry persistence.
  - `core/post.ts`: Reddit custom post creation helper.
- `/src/shared`: Code shared by client, server, and tests.
  - `pattern.ts`: Pure pattern generation, validation, and clue logic.
  - `game.ts`: Shared game/session/result types and session reducers.
  - `api.ts`: Shared API response/request type exports.
  - `versus.ts`: Configurable Versus rules, contracts, scoring, and replay helpers.
  - `progression.ts`: Pure XP, level, streak, and record rules.
- `/tests`: Focused Vitest coverage for pattern, game/session, progression, and Versus rules.

## Current Product Behavior

- Landing offers Daily, custom-seed, custom-pattern, and Versus play.
- Daily sessions, guesses, X marks, clue mode, results, leaderboard eligibility, XP, and streaks are server-backed. Daily dev reset clears the playable session but must never grant duplicate XP.
- Custom-seed and custom-pattern games are local, unlimited, and excluded from leaderboards and progression.
- Versus is asynchronous. Every player submits a hidden connected pattern of exactly `VERSUS_PATTERN_SIZE` tiles; the opponent solves that pattern using the normal board and server-side clue calculation.
- Public `Find Match` creates at most one match per submitted pattern. Keep this rule configurable through `VERSUS_MAX_OPPONENTS`; do not expose queue, round, cap, Redis, or polling terminology to players.
- Versus invitations use Reddit share data with an opaque invite ID. Patterns and identity stay server-side. Invitations expire after 72 hours, cannot be self-accepted, and may be claimed only once.
- Versus results rank fewer guesses first, then lower server-measured solve time. Result views include both replay grids, persistent head-to-head rivalry score, and XP earned. Lobby results aggregate by opponent: the three most recent opponents are shown with permanent totals and the latest five W/L/D dots, while search exposes every recorded opponent and a paged compact history.
- Progression is cosmetic and shared by Daily and Versus. XP awards and match settlement are idempotent; pending rewards remain until the client acknowledges their animation.
- Existing active Versus matches may settle under progression. Resolved matches from before progression are intentionally not awarded retroactively.
- Reddit-handle invitations, push notifications, and synchronous turn-by-turn Versus are deferred and are not part of the current implementation.

## Devvit Config

- The Devvit app/package name is currently `tilematching`; the development subreddit is `r/TileFinder`.
- `devvit.json` defines the app name, post entrypoints, server bundle, menu items, and triggers.
- When adding a new post entrypoint, menu endpoint, or trigger endpoint, update `devvit.json` in the same change.
- This project uses Devvit Web only. Do not add Blocks APIs or `@devvit/public-api`.

## Frontend Rules

- Keep heavy game code in `game.html` / `game.ts`; keep `splash.html` fast and lightweight.
- Avoid `window.location` or `window.assign` for Reddit navigation. Use `navigateTo` from `@devvit/web/client`.
- Do not use `window.alert`; use Devvit client helpers such as `showToast` or in-game UI.
- File downloads are not supported in Reddit iframes; use clipboard flows instead.
- Do not use inline scripts in HTML files. Add separate `.ts` entry files.
- Keep Daily leaderboard gameplay server-backed. Custom seed and custom pattern modes may remain local/off-leaderboard.

## Backend Rules

- Access `redis`, `reddit`, and `context` only from server-side code through `@devvit/web/server`.
- Daily clue calculation for leaderboard-eligible play should stay server-side.
- Keep Redis access behind storage helpers in `/src/server/core` where practical.
- Do not introduce external paid services, external hosting dependencies, AI/LLM calls, or payment flows.

## Current Handoff Status

- The architecture-first Daily foundation and the asynchronous Versus/progression prototype are implemented.
- Invitation reliability fallback is implemented: the client accepts full and iOS-minimal `devvitshare` URL envelopes from the SDK, visible URL, or referrer. Invite-code entry uses a real HTML input with desktop paste, mobile keyboard focus, sanitization, and Enter submission.
- The Versus invitation/result polish objective is implemented: shared invitations are consumed once, green-left Accept and red-right Decline actions are distinct, and completed results aggregate by opponent.
- Rivalry totals and compact chronological W/L/D history must persist permanently. Normal result cards show only the latest five outcomes, while an opponent search/history modal exposes the full compact history; detailed replay retention may remain bounded.
- Results should show the three most recently played opponents, one card per opponent. Active matches and pending requests remain separate because they carry match-specific actions.
- Type-check, lint, the 10 focused Versus Vitest tests, and the production build passed after the latest invitation reliability implementation.
- The local static preview can verify layout and local/custom play, but it cannot validate Reddit identity, Redis persistence, two-account matchmaking, or the native Reddit share sheet.
- The next validation step is `npm run dev -- TileFinder` with two Reddit accounts or browser profiles. Re-test both supplied full and iOS-minimal invitation URLs, plus typing and pasting invite codes on desktop, Android, and iPhone. The iOS host may still hide its outer share query from the iframe; the permanent code fallback covers that host-level failure.
- Art direction, final UI polish, subreddit playtesting, demo content, and launch review remain later work. Do not treat the current placeholder visuals as final art.

## Commands

- `npm run login`: Log in to Devvit.
- `npm run dev -- TileFinder`: Run Devvit playtest against `r/TileFinder`.
- `npx devvit playtest TileFinder`: Equivalent direct playtest command.
- `npm run type-check`: TypeScript project check.
- `npm run lint`: ESLint.
- `npm run test`: Run all Vitest tests.
- `npm run test -- tests/game.test.ts`: Run one test file.
- `npm run build`: Build client and server bundles.
- `npm run deploy`: Type-check, lint, then `devvit upload`.
- `npm run launch`: Upload and publish for Reddit review.

## Code Style

- Prefer type aliases over interfaces.
- Prefer named exports over default exports.
- Avoid TypeScript casts unless there is no cleaner narrowing option.
- Keep pure game rules in `/src/shared` so they can be tested without Phaser or Devvit.
- Keep Phaser UI changes scoped and responsive for both desktop Reddit posts and mobile Reddit views.
