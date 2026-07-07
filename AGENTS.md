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
- `/src/server`: Backend code executed in Devvit's serverless environment.
  - `index.ts`: Hono app entry point.
  - `routes/api.ts`: Daily session, guess, marker, mode, leaderboard, and dev reset APIs.
  - `routes/menu.ts`: Devvit menu action endpoints.
  - `routes/triggers.ts`: Devvit trigger endpoints.
  - `core/dailyStorage.ts`: Redis key naming and persistence helpers.
  - `core/post.ts`: Reddit custom post creation helper.
- `/src/shared`: Code shared by client, server, and tests.
  - `pattern.ts`: Pure pattern generation, validation, and clue logic.
  - `game.ts`: Shared game/session/result types and session reducers.
  - `api.ts`: Shared API response/request type exports.
- `/tests`: Focused Vitest coverage for pattern and game/session behavior.

## Devvit Config

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
