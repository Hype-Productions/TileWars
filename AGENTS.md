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
  - `scenes/tileWarsTheme.ts`: Canonical Phaser palette, tile, panel, button, HUD, outcome, and progression presentation primitives.
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
  - `core/post.ts`: Reddit custom post creation and idempotent stickied Daily-results-thread helper.
- `/src/shared`: Code shared by client, server, and tests.
  - `pattern.ts`: Pure pattern generation, validation, and clue logic.
  - `game.ts`: Shared game/session/result types and session reducers.
  - `markerSync.ts`: Pure serialized optimistic-marker queue and replay helpers shared by Daily and Versus clients.
  - `api.ts`: Shared API response/request type exports.
  - `versus.ts`: Configurable Versus rules, contracts, scoring, and replay helpers.
  - `progression.ts`: Pure XP, level, streak, and record rules.
- `/tests`: Focused Vitest coverage for pattern, game/session, progression, and Versus rules.

## Current Product Behavior

- The merged landing screen exposes Daily Challenge and 1v1 Battle using the final TILEWARS tile-board presentation. Legacy custom-mode types may remain in shared rules, but custom modes are not exposed by the current landing UI.
- Daily sessions, guesses, X marks, clue mode, results, leaderboard eligibility, XP, and streaks are server-backed. Daily dev reset clears the playable session but must never grant duplicate XP.
- A TILEWARS custom post is persistent: its Daily puzzle rolls over by UTC date inside the post. The app does not currently schedule a new Reddit post every day; installation creates a post and moderators may create additional posts through the menu action.
- Every app-created TILEWARS post owns exactly one app-authored stickied Daily results comment. Store its ID by post ID, create it idempotently for new or legacy posts, and submit generic player score comments as user-authored replies to that comment. Never bind this flow to a subreddit name.
- Custom-seed and custom-pattern games are local, unlimited, and excluded from leaderboards and progression.
- Versus is asynchronous. Every player submits a hidden connected pattern of exactly `VERSUS_PATTERN_SIZE` tiles; the opponent solves that pattern using the normal board and server-side clue calculation.
- Public `Find Match` creates at most one match per submitted pattern. Keep this rule configurable through `VERSUS_MAX_OPPONENTS`; do not expose queue, round, cap, Redis, or polling terminology to players.
- Versus invitations use Reddit share data with an opaque invite ID. Patterns and identity stay server-side. Invitations expire after 72 hours, cannot be self-accepted, and may be claimed only once.
- Versus results rank fewer guesses first, then lower server-measured solve time. Result views include both replay grids, persistent head-to-head rivalry score, and XP earned. The lobby has only Active Matches, Invitations, and Results; rematches are player-facing invitations. Results aggregate by opponent, and each compact history row opens a participant-authorized resolved replay view.
- Progression is cosmetic and shared by Daily and Versus. XP awards and match settlement are idempotent; pending rewards remain until the client acknowledges their animation.
- Existing active Versus matches may settle under progression. Resolved matches from before progression are intentionally not awarded retroactively.
- Reddit-handle invitations, push notifications, and synchronous turn-by-turn Versus are deferred and are not part of the current implementation.

## Final Polish Design Rules

- The canonical player-facing name is **TILEWARS**, rendered with the existing alternating colored letter tiles.
- The canonical palette is green `#35D07F`, red `#FF5365`, blue `#339DFF`, yellow/orange `#FFB12D`, cream `#FFF6DD`, panel `#FFFBEF`, ink/outline `#25313B`, and shadow `#142130`. Reddit orange `#FF4500` is reserved for Reddit-native actions such as posting a result comment.
- Treat `scenes/tileWarsTheme.ts`, `splash.css`, the existing board renderers, and repository assets as the final art direction. Refine and reuse them; do not introduce a parallel palette, button system, panel system, icon set, background, or animation language.
- UI should use dark outlined rounded tiles, raised shadows, heavy white tile text, cream panels, and the established gradient/tile backdrop. Inspect existing assets and primitives before adding a new visual asset or style.
- Extend shared Phaser primitives before creating scene-specific duplicates. Daily and Versus gameplay must share board geometry, HUD, Help, toolbar, feedback, and progression presentation; only mode-specific metadata and navigation should differ.
- Keep copy concise, gamified, and player-facing. Never expose queue, polling, Redis, cap, round, synchronization, or other implementation terminology to players.
- Check polished screens at desktop, standard mobile, 320px narrow-phone, and short landscape sizes. Long Reddit handles, large ranks, and two-digit counters must not collide or clip.
- Daily number uses the existing UTC `puzzleNumber`; never hardcode an example number. Daily streak appears only on splash and Daily gameplay, never in Versus.
- Guesses, clue calculation, solving, scoring, and settlement remain server-authoritative. X marks update optimistically, persist through serialized background requests, and reconcile safely on failure.
- Pending progression rewards must remain pending until the corresponding XP animation completes and the client acknowledges them.
- Keep the TILEWARS backdrop and heading mounted within each Phaser scene. Interaction renders, optimistic updates, modal changes, and lobby refreshes may rebuild content but must not replay or flicker the scene heading; animate it once only when entering a new scene.
- Treat public opponent searching as transient status beneath the action row, not as a fourth lobby category. Back belongs in the normal action row or the active subview and must never float above pickers, modals, history, or results.

## Active Final Polish Objective

- **Splash**: enlarged Daily number and fire-streak bookmark tiles straddling the Daily button's top-left border; compact Daily Leaderboard with alternating rank tiles, top three, ellipsis, and the player's row; no streak presentation on the Versus card.
- **Daily**: aligned equal-size Tiles Found/Guesses HUD, tile-styled Home/Help/X controls, immediate persisted X marks, useful clue feedback, and Daily number/streak metadata.
- **Versus Lobby**: TILEWARS heading, level/XP and plain color-coded W/L/D text, one-row Back/Find/Invite/Code navigation, Active Matches ordered before solved/waiting matches, one unified Invitations category, compact searching status, and no idle “up to date” message.
- **Pattern Picker**: one shared “Choose Your Pattern” screen for public, invitation, and rematch flows; six-connected-tile instruction; equal-width yellow Back, red Clear, and green Submit controls; Submit remains disabled until valid.
- **Invitations**: capitalized player-facing copy, green-left Accept and red-right Decline, direct Accept-to-picker transition, and wrapped equal-width Share Again/Copy Code/Cancel actions on narrow screens.
- **Gameplay**: Daily and Versus use the shared TILEWARS heading, board presentation, equal-size HUD, fitted How to Play guide, raised toolbar, clue feedback, and serialized optimistic marker flow. Versus adds only opponent, rivalry, and timer metadata.
- **History**: real HTML Search History input; exactly five chronological W/L/D tiles with empty cream placeholders; full-screen opponent history with outcome-colored clickable cards; each match opens the existing two-board result scene and returns to the same opponent/page.
- **Results**: Daily uses Pattern Complete with Daily metadata, compact leaderboard, Reddit-orange Comment, and animated XP. Versus uses gamified outcome copy, both replay grids, rivalry information, and the same reward animation and post-animation acknowledgement contract.

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
- Use the shared TILEWARS theme helpers for Phaser buttons, panels, headings, HUDs, outcome history, and progress meters. Keep the splash CSS variables synchronized with the same palette.
- Use real HTML inputs for text entry that must support paste or mobile keyboards; position them over Phaser UI and remove them cleanly when their modal closes.

## Backend Rules

- Access `redis`, `reddit`, and `context` only from server-side code through `@devvit/web/server`.
- Resolve post and results-thread targets from `context.postId` and stored Reddit IDs. Do not hardcode subreddit names, post IDs, comment IDs, or installation-specific setup into gameplay routes.
- Daily clue calculation for leaderboard-eligible play should stay server-side.
- Keep Redis access behind storage helpers in `/src/server/core` where practical.
- Do not introduce external paid services, external hosting dependencies, AI/LLM calls, or payment flows.

## Current Handoff Status

- The architecture-first Daily foundation and the asynchronous Versus/progression prototype are implemented.
- Invitation reliability fallback is implemented: the client accepts full and iOS-minimal `devvitshare` URL envelopes from the SDK, visible URL, or referrer. Invite-code entry uses a real HTML input with desktop paste, mobile keyboard focus, sanitization, and Enter submission.
- Shared invitation links are now handled by the default splash entrypoint as well as the expanded game. Query-string, hash-route, SDK, visible-URL, referrer, and encoded iOS-minimal envelopes open the styled splash Accept/Decline prompt; Accept carries a short-lived intent into Versus and continues through the server-authoritative invitation flow to the shared picker.
- Newly created invitations persist a Reddit-shortened canonical URL containing the complete `devvitshare` envelope. Sharing prefers that exact URL through the native Web Share API and includes it in the Devvit share-sheet fallback, avoiding the platform-specific minimal link produced by some iOS hosts. Legacy invitations without a canonical URL keep the existing invite-code/share fallback until they expire.
- The Versus invitation/result polish objective is implemented: shared invitations are consumed once, green-left Accept and red-right Decline actions are distinct, and completed results aggregate by opponent.
- Rivalry totals and compact chronological W/L/D history must persist permanently. Normal result cards show only the latest five outcomes, while an opponent search/history modal exposes the full compact history; detailed replay retention may remain bounded.
- Results should show the three most recently played opponents, one card per opponent. Active matches and pending requests remain separate because they carry match-specific actions.
- Type-check, lint, the 10 focused Versus Vitest tests, and the production build passed after the latest invitation reliability implementation.
- The local static preview can verify layout and local/custom play, but it cannot validate Reddit identity, Redis persistence, two-account matchmaking, or the native Reddit share sheet.
- The next validation step is `npm run dev -- TileFinder` with two Reddit accounts or browser profiles. Re-test both supplied full and iOS-minimal invitation URLs, plus typing and pasting invite codes on desktop, Android, and iPhone. The iOS host may still hide its outer share query from the iframe; the permanent code fallback covers that host-level failure.
- The merged TILEWARS art direction is canonical and the active work is final UI/UX polish. Do not replace it with template or placeholder visuals.
- Before final-polish implementation, type-check, lint, all 26 focused Vitest tests, and the production build passed on the merged architecture.
- After the canonical share-link repair, type-check, lint, all 45 focused Vitest tests, and the production build pass. Static browser checks cover the splash invite prompt and Accept handoff at 390×844, 320×568, and 844×390 in addition to the earlier splash, loading, Help, stable-heading, and lobby checks; real Reddit validation remains required for iOS-created canonical links, server-backed history, and two-account flows.
- Daily score sharing uses `runAs: 'USER'` and replies to one app-created stickied results comment per custom post. Existing posts lazily create and retain the same results-thread target; new posts prepare it during post creation. Playtest comments from non-owner accounts are expected to use the app account until Reddit approves the app version.
- The built Phaser pages require the Devvit host bridge and cannot be visually exercised by a standalone static server. Complete their responsive, identity, persistence, share-sheet, matchmaking, and settlement checks in the real Devvit playtest.
- Final validation must cover 1000×700, 390×844, 320×568, and 844×390 layouts plus two-account Reddit playtests for matching, invitations, search input, settlement, rivalry history, and progression acknowledgement.

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
