# TILEWARS Project Story

## Inspiration

We were inspired by two things that already work naturally on Reddit: communities returning to the same daily topic, and people comparing how they solved a shared challenge. We wanted to turn that behavior into a game that lives directly inside a post instead of sending players to a separate website.

That became TILEWARS: a compact deduction game where everyone receives the same Daily board, discusses results in the community, and can turn another player into a long-term rival. Our goal was to make something easy to begin in a few seconds but deep enough to reward careful reasoning, efficient guesses, and repeated play.

## What it does

TILEWARS is a Reddit-native logic game played on a colorful 5x5 grid. Each Daily Challenge hides a connected pattern of four to seven tiles. Selecting a tile reveals every clue that applies:

- Green means the selected tile belongs to the hidden pattern.
- Red means a pattern tile is in the same column.
- Blue means a pattern tile is in the same row.
- Orange means a pattern tile is on a diagonal.

Because clues can combine, each selection provides structured information rather than a simple correct-or-incorrect answer. Players can also place free X marks as private notes while narrowing down the possibilities. The goal is to uncover the entire connected pattern with as few guesses as possible.

The same deterministic Daily puzzle is available to everyone for one UTC day. After solving it, players can compare their rank on the Daily leaderboard, build a consecutive-day streak, earn XP, level up, and share their result in the post's community results thread. Progression also maps players to level-based TILEWARS titles and community flair.

TILEWARS also includes asynchronous 1v1 play. Each player creates a connected six-tile pattern for an opponent and solves the pattern they receive. Players can find a public opponent, send a Reddit invitation link, share a short invitation code, or request a rematch. Matches compare the number of guesses first and server-measured solve time second. Completed matches include both replay boards, persistent win/loss/draw records, rivalry history, and rematch opportunities. The players never need to be online at the same time.

The complete experience runs inside Reddit posts on desktop and mobile, including the game, progression, invitations, leaderboards, result sharing, and rivalry loop.

## How we built it

We built TILEWARS as a Devvit Web application using Phaser 4, TypeScript, and Vite for the client. The backend runs in Devvit's Node.js serverless environment with Hono, while Devvit Redis stores Daily sessions, leaderboards, XP profiles, streaks, invitations, matches, results, and rivalry records. The project uses no external hosting, paid services, or AI APIs.

The client is divided into a lightweight post-feed splash screen and the expanded Phaser game. Shared visual primitives provide the raised tiles, panels, controls, board geometry, progress meters, and responsive TILEWARS presentation used across Daily and Versus screens.

Game rules are separated from rendering. Pure shared modules generate connected patterns, calculate clues, reduce game sessions, validate player-created Versus patterns, calculate scores, advance streaks and levels, and build replay data. Vitest covers these rules independently of Reddit and Phaser, while TypeScript, ESLint, and production builds provide additional release checks.

Leaderboard-eligible gameplay is server-authoritative. The server validates guesses, calculates clues, measures solve time, settles matches, and awards XP. Awards and settlement are idempotent, so retries or a Daily reset cannot duplicate progression. X marks update immediately in the interface while serialized requests persist and reconcile them safely with the server.

Reddit is part of the architecture rather than just a place to host a link. Installation creates the interactive post and its app-authored results thread, player result sharing replies to that thread, invitations use Reddit sharing with a short-code fallback, and progression can be reflected through subreddit flair.

## Challenges we ran into

The largest design challenge was making a small clue system feel logical instead of random. A single tile can reveal row, column, diagonal, and exact-hit information simultaneously, so pattern generation and clue presentation had to remain consistent enough for players to reason from one move to the next.

Asynchronous multiplayer introduced a different set of problems. Patterns and player identity needed to stay server-side, invitations needed to be single-use and resistant to self-acceptance, and a match had to settle exactly once even when either participant returned much later. We also had to define a fair result order: fewer guesses wins, with server-measured solve time breaking ties.

Invitation sharing was especially challenging across Reddit hosts. Desktop, Android, and iOS can expose shared-link information differently to an embedded app. We handled full share envelopes, shortened canonical URLs, visible URLs, referrers, and a five-character code fallback so a player can still join when a host does not pass the complete link into the iframe.

Persistence required careful boundaries. Daily sessions, progression, pending reward animations, match settlement, and rivalry history all have different lifecycles. We designed idempotent storage operations so refreshing, retrying a request, resetting a development session, or reopening an old result would not grant duplicate XP or corrupt a match.

Finally, a game inside a Reddit post must work in very different spaces. We refined the interface for desktop posts, standard phones, 320px-wide screens, and short landscape layouts while protecting long Reddit handles, rankings, counters, modals, and mobile keyboard inputs from clipping or colliding.

## Accomplishments that we're proud of

We are proud that TILEWARS grew from one compact puzzle mechanic into a complete Reddit-native game loop without losing its simplicity.

- The Daily Challenge gives the whole community the same fair board and leaderboard.
- The clue system rewards deduction while still being understandable through four consistent colors.
- Asynchronous Versus lets players create the challenge itself, not merely replay a generated board.
- Public matching, invitation links, short codes, rematches, replay boards, and rivalry history form a complete multiplayer loop.
- Server-authoritative scoring and idempotent progression keep XP, streaks, results, and records reliable.
- The same playful visual language works across the feed view, gameplay, lobby, invitations, history, and results.
- The game remains fully contained within Reddit and Devvit, with no external backend or paid dependency.
- The automated suite now passes 49 focused tests alongside type-checking, linting, and the production build.

We are also proud of the smaller details that give the game character: the interactive TILEWARS heading, playful background tiles, private X-mark notes, animated XP rewards, visible level titles, and the ability to reopen both boards from a rivalry result.

## What we learned

We learned that designing for Reddit is different from embedding a conventional web game. The strongest features are the ones that use the surrounding community: a shared Daily board, result comments, visible progression, invitations, and rivalries. Reddit identity and conversation can become part of the game rather than decoration around it.

We also learned the value of separating pure rules from UI and storage. Keeping pattern generation, clues, scoring, progression, and replay logic in shared TypeScript modules made those systems easier to test and gave Daily and Versus one consistent foundation.

Building asynchronous competition taught us to treat every server mutation as retryable. Idempotent awards, single-use invitations, authorized result access, and deterministic settlement are not background implementation details; they are what make the player-facing experience trustworthy.

Finally, we learned to design fallbacks around the host environment. Native sharing is convenient when it works, but robust invitation codes, real HTML inputs, optimistic UI reconciliation, and responsive layouts are what make the experience survive different devices and Reddit clients.

## What's next for TileWars

Our immediate next step is to observe how players approach the Daily clues and Versus pattern creation, then refine onboarding and balance using real community feedback. We want to keep the public judging build stable while using a separate private installation for debugging and validation.

After judging, we plan to improve long-term storage policies, bound detailed replay retention while keeping meaningful rivalry totals permanent, and expand privacy-conscious gameplay analytics. We also want to add more release polish, accessibility improvements, and clearer onboarding for first-time players.

Longer term, TILEWARS can support community events, seasonal competitions, special Daily variations, and additional cosmetic recognition without changing the core deduction rules. The central idea will remain the same: one colorful board, information in every move, and a Reddit community solving and competing together.
