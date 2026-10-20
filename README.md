# SO/FACET

This repository contains our cinematic website, pinball game and membership frontend, together with the Node service that verifies scores and connects to the rewards backend.

The frontend follows the approved black, violet and lime visual direction. Please keep the shared navigation, game presentation and responsive layouts consistent when connecting the remaining services.

## Run locally

Use **Node.js 26**, npm and Git LFS. The server uses Node's native TypeScript support for shared game simulation code.

```sh
git lfs install
git lfs pull
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8766/`. For local configuration, copy `.env.example` to `.env` and fill in values privately. The game can run without rewards credentials; registration and reward saving require the services described below.

```sh
node --test --test-concurrency=1 tests/*.test.mjs
npm run smoke
```

Tests use temporary storage and synthetic services. The local smoke check starts an isolated server, checks page assets and video streaming, and removes its temporary player data afterward.

## Project structure

| Location | Responsibility |
| --- | --- |
| `index.html`, `style.css`, `viewer.js`, `sequence.js` | Landing experience, scroll sequence and game handoff |
| `assets/landing-copy.js`, `assets/kinetic-copy.js` | Configurable story copy, frame ranges and masked text transitions |
| `navigation.js`, `assets/navigation.css` | Shared brand placement, hamburger and navigation drawer |
| `game-source/` | Three.js table, Rapier physics, controls, scorecard, leaderboard and rewards screen |
| `membership-source/` | React registration, phone verification, validation and save/leave flows |
| `faq-source/`, `about-source/` | React informational pages |
| `server.mjs`, `verify-game.mjs`, `replay-worker.mjs` | Same-origin API, player sessions and score verification |
| `membership-api.mjs`, `membership-otp.mjs`, `rewards.mjs` | Membership, SMS integration boundary and external rewards adapter |
| `scripts/`, `tests/` | Builds, deployment checks and automated tests |
| `assets/`, `sounds/`, `vendor/`, `leaderboard/`, `references/` | Runtime media, exported table data and bundled dependencies |
| `licenses/` | Third-party license and audio attribution notices |

`npm run build` checks TypeScript and rebuilds the frame index, game and all React pages. Generated `play.html`, `membership.html`, `faq.html`, `about.html` and their browser bundles are included. Edit the corresponding source directory and rebuild instead of editing generated pages.

## Experience and gameplay

- The landing reveal leads into the interactive scroll journey. Story text is tied to its approved frame ranges; the welcome copy clears before frame 240.
- The queen impact at source frame 2164 hands directly into the game. Play now bypasses the journey.
- Navigation uses the same brand anchors and drawer across pages. Settings and profile open inside that drawer. The active page is unavailable in its own menu.
- Registered players skip membership screens and can open the leaderboard. Unregistered players enter registration before any leaderboard request; both leaderboard API routes enforce membership.
- Phone and tablet layouts use touch controls and a compact scorecard. Desktop retains the keyboard instructions and flip card. Sound controls respect browser activation requirements.
- Game rewards display `pts`; the conversion remains **10 points = ₹1**.

| Table interaction | Score |
| --- | ---: |
| SOFACET letter target | +1,000 |
| Triangular block | +100 |
| Ring block | +50 |
| Cyan bumper | −500 |
| Neon green bumper / drum | +500 |
| Launcher | +450 once per launch |
| Cave | +3,000 |

Scoring is shared between the client simulation and server replay verification. Keep replay versions, collision data and simulation parameters in sync when changing gameplay.

## Backend integration

### Sessions and verified scores

`GET /api/player` supplies the current player's authoritative state using an HttpOnly session cookie. Membership recognition currently applies to that browser session; cross-device login is a separate backend requirement.

The client starts a game with `POST /api/games/start`, then submits its replay version and packed control inputs to `POST /api/games/:id/finish`. The server replays those controls against the shared simulation and records the score. Do not accept client-supplied scores or redeemable reward amounts.

All writes require JSON and the configured exact Origin. Keep the frontend and API on the same origin unless the session and origin model is deliberately updated.

### Membership contracts

| Endpoint | Request / response |
| --- | --- |
| `GET /api/membership/config` | Public OTP availability, approved policy URLs and `pointsPerRupee: 10` |
| `POST /api/membership/otp/request` | `{phoneNumber}` → `{success, challengeId, expiresIn, resendAfter}` |
| `POST /api/membership/otp/verify` | `{phoneNumber, otp, challengeId}` → `{verified, verificationToken}` |
| `POST /api/membership` | `{name, leaderboardName, email, dateOfBirth, city, termsAccepted, marketingConsent, phoneNumber, verificationToken, gameId?}` → player and saved-reward status |
| `POST /api/membership/rewards` | Existing member sends `{gameId}` → `{success, pointsSaved, savedPoints, bestPoints, remainingPoints}` |
| `GET /api/leaderboard` | Member-only game ranking with `entries` and `me` |
| `GET /api/rewards/leaderboard` | Member-only external rewards ranking; requires rewards configuration |

The legacy `/api/member` compatibility route remains available and does not grant game rewards. The current React flow uses `/api/membership`; review legacy access before opening public registration.

The form keeps one **Name** field. The leaderboard name is editable during registration. Saving requires age 18+, accepted membership terms and confirmed phone verification. Marketing consent is optional and defaults off. Under-18 users can continue as guests.

The OTP verification token is a short-lived internal proof bound to the current session and phone. It is not the external rewards JWT. Form details, codes and verification proofs are not persisted in browser storage.

### Remaining service connections

1. **SMS OTP:** `otpProvider.request` and `otpProvider.verify` in `membership-otp.mjs` are intentionally `null`. Connect the chosen SMS provider on the server. Request returns `{challengeId, expiresIn}`; verify returns `{verified: true}` only after provider confirmation. The surrounding API already handles expiry, resend cooldown and attempt limits. Until connected, requests return an unavailable response; there is no demo verification path.
2. **International phone support:** the frontend normalizes international numbers to E.164. Server phone validation currently accepts Indian `+91` numbers only. Extend server validation and provider coverage together before enabling additional countries.
3. **Profile name updates:** the drawer includes an editable leaderboard-name flow. Supply an optional same-origin `/api/…` `profileUpdateUrl` in public membership configuration and implement authenticated updates. The proposed request is `{leaderboardName}` with `{success: true, status: "saved" | "pending"}` returned. Persist the approved name in player state; a pending moderation response must retain the current public name. No endpoint is connected yet.
4. **Approved policies:** Terms and Privacy content was left out pending approval. Set `MEMBERSHIP_TERMS_URL` and `MEMBERSHIP_PRIVACY_URL` to the approved HTTPS URLs. Registration currently refuses completion without them. The existing Privacy page is a placeholder.
5. **Commerce redemption:** apply the approved redemption cap, exclusions and expiry in the commerce backend when the shop opens. The frontend explains these rules; it does not enforce order eligibility.
6. **Tracking:** live Meta and Google tags were intentionally left out. Connect them only when the approved identifiers and consent requirements are available.

### Rewards adapter

The documented rewards service is called only by the Node backend:

- `/rewards/auth` resolves the phone to a customer and issues an upstream session.
- `/rewards/points` receives server-calculated credits with a stable idempotency key.
- `/rewards/leaderboard` supplies the optional rewards ranking.

**One upstream reward unit is ₹1; ten game points are ₹1.** A verified 3,200-point result therefore grants 320 upstream units. Only improvement over the customer's previous best earns additional credit. Retries reuse the pending award's key, and replays of lower scores do not grant credits. Remainders below ten points stay recorded without rounding upward.

The private reward ledger is keyed by the upstream customer ID. Keep it persistent, along with player and game records. The protected internal award endpoint requires `REWARDS_ADMIN_SECRET`; it is not a browser API.

The approved purchase rule is up to 10% of diamond value plus making charges, excluding metal, GST and shipping. Points are non-transferable, cannot be combined with sale items or other offers, and expire six months after the main shop launch. No launch date or prize is promised.

## Configuration and hosting

| Variable | Purpose |
| --- | --- |
| `HOST`, `PORT` | Listener; use `HOST=0.0.0.0` on the host |
| `APP_ORIGIN` | Exact public HTTPS origin for cookie and write-origin checks |
| `DATA_DIR` | Private persistent directory for player, game and reward records |
| `REWARDS_API_BASE` | Documented rewards service origin; adapter restricts credential forwarding |
| `REWARDS_API_KEY` | Private server integration credential |
| `REWARDS_ADMIN_SECRET` | Private credential for internal reward awards |
| `LEADERBOARD_MODE` | `game` by default; `rewards` requires the external service |
| `MEMBERSHIP_TERMS_URL`, `MEMBERSHIP_PRIVACY_URL` | Approved public HTTPS policy URLs |

Keep real values in the hosting environment or local ignored `.env`, never in React, `VITE_*`, browser assets or source control. `.env.example` contains no credentials. Do not commit player records, logs, private documents or authoring projects.

This application needs **Node hosting**, not static-only hosting. Use `npm ci`, `npm run build`, then `npm start`. The server streams MP4 byte ranges and blocks access to private server files. Keep required Git LFS media materialized before serving.

### Existing Railway pipeline

The repository's GitHub Actions workflow runs build and smoke checks on pull requests and pushes to `main`. Successful pushes to `main` trigger the existing production Railway deployment, followed by health and streaming checks. Preserve the current workflow and hosting environment configuration.

The configured service URL is `https://facet-pinball-production.up.railway.app`; `shopsofacet.com` still requires the corresponding DNS configuration. `/health` is a read-only readiness endpoint. The workflow reads `RAILWAY_TOKEN` from GitHub Actions secrets; it must never appear in this repository.

Railway's build materializes the experience video from GitHub LFS and verifies its committed SHA-256 and size. Local builds with LFS already available reuse that file. A private repository would require an authenticated media download path.

Keep the service at **one replica** with persistent `DATA_DIR` storage. The current atomic file store is designed for one process. Move player, score and reward state to shared transactional storage before running multiple replicas.

## Verification and release checks

Automated tests cover score verification, scoring and target placement, membership validation, reward retry/idempotency rules, frontend state/copy, member-only leaderboard access, frame-cache bounds and video fallback behavior. Browser checks have covered desktop, phone and tablet layouts in Chromium and WebKit.

Before collecting memberships publicly, finish SMS and approved policies, test the live rewards connection, and verify the complete flow on physical Safari/iPhone devices. Automated WebKit checks do not replace real-device video, audio and touch testing.
