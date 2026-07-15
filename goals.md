# TILEWARS Launch Goals

## Deadline and links

- **Hackathon deadline:** July 16, 2026 at 04:00 Europe/Athens (July 15 at 18:00 PDT).
- **Developer listing:** https://developers.reddit.com/apps/tilematching
- **Public community:** https://reddit.com/r/TileWars
- **Playable post:** _Add the direct public post URL after installation._
- **How to Play post:** _Add the direct public post URL after publishing it._
- **Devpost submission:** _Add the submitted project URL._

`tilematching` is the permanent internal Devvit app identifier. TILEWARS is the public display name. Do not create a second Devvit app for the launch.

## Completed

- [x] Created and branded the public `r/TileWars` community.
- [x] Updated the Developer Portal display name and description to TILEWARS.
- [x] Fixed Daily result commenting and the app-owned stickied results thread.
- [x] Fixed the result popup so it keeps the earned Daily streak XP instead of overwriting it with zero.
- [x] Kept the private playtest community as a separate debugging installation.
- [x] Verified the pre-launch baseline with type-check, lint, tests, and a production build.

## Critical path before Devpost submission

### Codex

- [x] Set July 15, 2026 UTC as Daily #1.
- [x] Point the splash `r/` action to public `r/TileWars`.
- [x] Update the moderator menu copy to TILEWARS.
- [x] Preserve the result-thread and streak-XP fixes without changing Redis retention.
- [x] Run the final type-check, lint, all 48 tests, and production build.
- [ ] Start the public `r/TileWars` playtest and capture the playable post URL.

### Partner

- [ ] Replace the root `README.md` with accurate player/reviewer-facing copy before the final upload or publish.
- [ ] Explain Daily Challenge, asynchronous 1v1, player-created patterns, progression, Reddit integration, and Redis-backed persistence.
- [ ] Remove the obsolete claim that the project does not use Redis.
- [ ] Prepare the Devpost project story using the same accurate product description.
- [ ] Provide final screenshots or captions for the Devpost entry.

### User

- [ ] Confirm the public playable post opens for a non-moderator account.
- [ ] Pin the playable post in `r/TileWars`.
- [ ] Publish and pin the How to Play post below.
- [ ] Complete the two-account Daily and Versus validation checklist.
- [ ] Add the playable post, How to Play post, and Devpost URLs above.
- [ ] Submit the developer listing and public playable post to Devpost before the deadline.
- [ ] Authorize and run the final unlisted Reddit publish after the partner README is incorporated.

## Paste-ready How to Play post

**Title:** How to Play TILEWARS

TILEWARS is a Daily pattern hunt and asynchronous 1v1 battle played directly on Reddit.

### Daily Challenge

Find every tile in the hidden connected pattern on the 5x5 board.

- **Green:** The tile is part of the pattern.
- **Red:** A pattern tile is in the same column.
- **Blue:** A pattern tile is in the same row.
- **Orange:** A pattern tile is on a diagonal.
- **X marks:** Rule out tiles without spending a guess.

Finish the Daily in as few guesses and as little time as possible. Daily solves build your streak, award cosmetic XP, and place you on the community leaderboard.

### 1v1 Battle

Choose a hidden connected pattern of exactly six tiles, then challenge another player. You solve their pattern while they solve yours. Fewer guesses wins; solve time breaks ties.

Use Find Match for a public opponent or Invite to share a challenge. Results include both replay boards, rivalry totals, match history, and XP earned.

**Play TILEWARS:** _Replace this line with the direct playable post URL._

## Public validation checklist

- [ ] Splash shows TILEWARS and Daily #1 on July 15 UTC.
- [ ] The `r/` action opens `r/TileWars`.
- [ ] Daily guesses, clues, X marks, refresh persistence, and Help work.
- [ ] A completed Daily shows the correct guesses, time, base XP, and streak bonus.
- [ ] The Daily leaderboard is shared between two public-community accounts.
- [ ] Post Result replies beneath the single app-owned stickied Daily-results comment.
- [ ] A second account can create and complete a public Versus match.
- [ ] Invitation sharing, code entry, result settlement, rivalry, and replay work.
- [ ] Validate 1000x700, 390x844, 320x568, and 844x390 layouts.
- [ ] The playable post works after the local playtest process is stopped.

During an unapproved playtest, a `runAs: 'USER'` result comment may appear from the app account. Recheck user-authored attribution after Reddit approves the app version.

## Devpost and Reddit release checklist

- [ ] Verify the Developer listing opens and displays TILEWARS.
- [ ] Verify the demo URL is a direct public playable post, not only the subreddit homepage.
- [ ] Add the project story, screenshots, technologies, and required links to Devpost.
- [ ] Submit Devpost before the deadline.
- [ ] After submission and README completion, run the unlisted publish flow without `--public`.
- [ ] When approved, manually update `r/TileWars` to the approved stable version.

The hackathon requires the existing developer listing and a public post running the game. A public App Directory listing is not required for this single-community game.

## Sell-sheet outline

Keep this as source material unless a polished one-page asset is requested later.

1. **Hook:** Hunt the Daily pattern, then design one to outsmart another Redditor.
2. **Daily Challenge:** Shared UTC puzzle, clue-driven discovery, leaderboard, and streak.
3. **Asynchronous 1v1:** Submit a six-tile connected pattern and solve an opponent's board.
4. **User contribution:** Every Versus pattern is created by a player and becomes another player's challenge.
5. **Retention:** Daily streaks, cosmetic XP, levels, persistent rivalries, and replay history.
6. **Reddit-native community:** Public gameplay post, score replies, invitations, and community leaderboard.
7. **Technology:** Devvit Web, Phaser 4, TypeScript, Hono, and installation-scoped Devvit Redis.
8. **Recommended screenshots:** Splash/Daily card, active Daily board with clues, and a Versus result with both replay grids.
9. **Call to action:** Play in `r/TileWars` using the direct demo-post link.

## Post-judging backlog

- Define and test bounded retention for obsolete Daily working data and detailed Versus replays.
- Repair any Redis TTLs lost when expiring Versus records are rewritten.
- Add broader product analytics only if they remain Reddit-native and privacy appropriate.
- Continue responsive and accessibility polish based on judge and community feedback.
- Batch future stable releases, submit each release for review, and manually update the public installation after approval.

Do not perform Redis retention or expiry changes until judging is complete unless a confirmed production bug requires them.
