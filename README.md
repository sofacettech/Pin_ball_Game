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

For ZIP downloads, skip the two `git lfs` commands above. If the archive contains a Git LFS pointer instead of the full video, `npm run build` downloads the approved video and verifies its size and SHA-256 before using it. Internet access to the public media mirror is required for that first build; an already materialized video is reused.

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
| `faq-source/`, `about-source/` | React informational pages, including the Explore collection gallery |
| `account-source/`, `shared/` | React account flow and shared brand text |
| `server.mjs`, `verify-game.mjs`, `replay-worker.mjs` | Same-origin API, player sessions and score verification |
| `membership-api.mjs`, `membership-otp.mjs`, `rewards.mjs` | Membership, SMS integration boundary and external rewards adapter |
| `scripts/`, `tests/` | Builds, deployment checks and automated tests |
| `assets/`, `sounds/`, `vendor/`, `leaderboard/`, `references/` | Runtime media, exported table data and bundled dependencies |
| `licenses/` | Third-party license and audio attribution notices |

`npm run build` checks TypeScript and rebuilds the frame index, game and all React pages. Generated `play.html`, `membership.html`, `faq.html`, `about.html`, `account.html` and their browser bundles are included. Edit the corresponding source directory and rebuild instead of editing generated pages.

## Experience and gameplay

- The landing reveal leads into the interactive scroll journey. Story text is tied to its approved frame ranges. The welcome copy stays visible until scrolling starts, fades out over one second and returns when the player scrolls back to the starting position. Reduced-motion mode switches immediately.
- The queen impact at source frame 2164 hands directly into the game. Skip to Game bypasses the journey.
- Navigation uses the same brand anchors and drawer across pages. Settings and profile open inside that drawer. The active page is unavailable in its own menu.
- Registered players skip membership screens and can open the leaderboard. Unregistered players enter registration before any leaderboard request; both leaderboard API routes enforce membership.
- Phone and tablet layouts flip between Hold to launch and the live scorecard as the ball launches and returns. Desktop retains the keyboard instructions and flip card, with a Hold button below the card. Only one paddle accepts input at a time; the held paddle keeps priority until released. Sound controls respect browser activation requirements.
- Membership Back returns to the landing experience without replaying the intro loader. Registration steps still move back within the form.
- The About page uses the approved Explore layout with scroll reveals and a keyboard-accessible collection gallery. The shared navbar and current-page menu behavior apply there as well.
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
| `MEDIA_CDN_BASE_URL` | Public R2 custom domain for videos; empty keeps local delivery |
| `DATA_DIR` | Private persistent directory for player, game and reward records |
| `REWARDS_API_BASE` | Documented rewards service origin; adapter restricts credential forwarding |
| `REWARDS_API_KEY` | Private server integration credential |
| `REWARDS_ADMIN_SECRET` | Private credential for internal reward awards |
| `LEADERBOARD_MODE` | `game` by default; `rewards` requires the external service |
| `MEMBERSHIP_TERMS_URL`, `MEMBERSHIP_PRIVACY_URL` | Approved public HTTPS policy URLs |

Keep real values in the hosting environment or local ignored `.env`, never in React, `VITE_*`, browser assets or source control. `.env.example` contains no credentials. Do not commit player records, logs, private documents or authoring projects.

This application needs **Node hosting**, not static-only hosting. Use `npm ci`, `npm run build`, then `npm start`. The server streams MP4 byte ranges and blocks access to private server files. Keep required Git LFS media materialized before serving.

### Existing Railway pipeline

The repository's GitHub Actions workflow runs build, unit and smoke checks plus Chromium and WebKit mobile video checks on pull requests and pushes to `main`. Railway's existing GitHub repository integration handles production deployments from the connected `main` branch. The workflow does not run a second Railway CLI deployment or require a `RAILWAY_TOKEN` secret. Enable Railway's **Wait for CI** service setting when automatic deployment should wait for these checks to pass.

The configured service URL is `https://facet-pinball-production.up.railway.app`; `shopsofacet.com` still requires the corresponding DNS configuration. `/health` is a read-only readiness endpoint. After deployment, `npm run smoke -- https://facet-pinball-production.up.railway.app` verifies the public site and streamed media.

I've kept the video download tied to an exact revision of our public `sofacettech/Pin_ball_Game` media mirror. It does not use the deployment repository's `RAILWAY_GIT_COMMIT_SHA`, so builds from a separate repository or ZIP export can retrieve the same approved video. The download replaces the LFS pointer only after the committed SHA-256 and size match. If we replace the video, please update the pinned mirror revision in `scripts/materialize-video.mjs` together with the LFS object, frame index and media manifest. A private mirror would require an authenticated server-side download path.

The mobile video CI job also fetches its fixed comparison baseline from `sofacettech/Pin_ball_Game`, independently of the checkout's `origin`. Keep that baseline available in the public mirror when moving the application to another repository. Hosting credentials belong in the service environment; neither download path needs a password in source control.

Keep the service at **one replica** with persistent `DATA_DIR` storage. The current atomic file store is designed for one process. Move player, score and reward state to shared transactional storage before running multiple replicas.

### R2 video delivery

The app, APIs, frame index and fallback media remain on Railway. When configured, the two public MP4 files are served through an R2 custom domain. Use a dedicated bucket; `ops/r2-cors.json` permits public GET/HEAD requests and exposes the byte-range headers required by the frame decoder. The production delivery URL must be a custom domain, because `r2.dev` does not provide CDN caching.

Desktop and mobile share a high-quality 1920×1080 H.264 encode at 60 FPS, retaining all 1,990 journey frames and the same camera, copy, sound and game handoff timing. The all-IDR encode uses x264 slow / CRF 16, Rec.709, YUV420p and faststart. It is visually close to the original, not mathematically lossless: 171,078,178 bytes versus 248,630,827 bytes (31.2% smaller), with full-sequence SSIM 0.995112 against the original after timestamp normalization. No resizing or frame-rate reduction is applied. Mobile optimizations bound download concurrency and decoded-frame memory; grouped byte-range requests and directional prefetching reduce stalls. No HLS/Stream transcoding is used: every scroll frame must remain independently decodable and match its byte index.

On desktop, Safari's native decoder can retain immutable full-resolution `VideoFrame` surfaces. The mobile cache retains at most four frames (about 32 MiB as RGBA), plus one in-flight decode, prioritizes frames in the scroll direction, and releases frames when the page is hidden. Buffered frames are presented in the animation loop alongside scene placement and copy. Touch devices and older browsers without `VideoFrame` use the native video compositor while scrolling. Once the requested destination and frame queue are idle, the timestamp-confirmed frame is captured into the existing canvas to preserve stable pixels after WebKit pauses. Resuming scroll cancels an obsolete confirmation; intermediate frames avoid full-size canvas copies. Native pacing adapts to slow seek completion: large swipes skip obsolete intermediate samples and ease toward the latest scroll target instead of accumulating a long four-frame-step backlog. Nearby movement keeps small steps. Native motion requests use a 30 Hz deadline scheduler independent of page RAF only while the verified all-IDR `fastSeek` path remains accurate: a completed seek can start the next due request without losing another screen refresh, while useful pending work remains single-flight. Small timer delays retain the 30 Hz phase instead of accumulating drift. Moving fast-seeks wait for a matching compositor acknowledgment before releasing the next seek, bounded to one additional 30 Hz interval when paused-video callbacks are missing; wait time and fallback counts are exported in Debug. Slow seeks do not build a burst of missed timer work, and idle/hidden pages stop the scheduler. Browsers using precise `currentTime` seeking retain responsive RAF pacing; an inaccurate or failed `fastSeek` switches back to that path immediately. Decoded data and playback permission are tracked separately; if a browser blocks settled playback, a Tap to resume journey control activates the video directly inside the gesture and retries confirmation without reloading the buffer. The WebKit release check compares rendered pixels with the selected native video and measures continuous forward/reverse scrolling against the previous renderer on the same runner; source FPS is not a guarantee of rendered FPS on a physical phone.

After the opening, the live 43-plate ball loops its authored split poses in a wave while a bounded opening buffer warms. The gate requires a decoded first frame and three seconds of native buffering (or the native HAVE_ENOUGH_DATA signal, because Safari caps paused prefetch). WebCodecs prepares up to 360 compressed samples on desktop or 57 on constrained devices, within 75% of a 48 MiB desktop / 10 MiB constrained-device budget. Desktop retains up to 512 compressed frames and eight decoded images, including 224 frames of reversal history. The window shrinks near the ending instead of downloading extra old history, and immediate playback ranges take priority over distant swipe destinations. It never downloads the entire movie into JavaScript memory or retains all decoded frames. Changing copy, real buffer progress, retry and Skip to Game remain available; reduced motion disables the wave. This initial buffer cannot guarantee stall-free playback on every network or device. Game iframe initialization starts only once the final cinematic frame is settled; the game loader covers any remaining handoff wait so game startup does not compete with the ending.

Run `npm run build:frames` after changing source media. It checks Full HD dimensions, 60 FPS, colour metadata and an IDR in every frame, then generates the matching manifest and content hashes. The manifest intentionally maps both device profiles to the same Full HD files.

Touch devices keep the scene at a stable large viewport height while browser bars resize the controls. Native video uses `object-fit: contain` inside the 16:9 stage so viewport changes cannot stretch the ball. The WebGL backing buffer is capped at Full HD, and the journey canvas is allocated on its first draw and released on exit. With a local server running, `SOFACET_VIDEO_URL=http://127.0.0.1:8768 node scripts/browser-mobile-geometry.mjs` checks portrait, landscape and simulated browser-bar changes with automatic and forced native playback.

To capture a physical phone's scroll performance, open the site with `?perf=1`. It starts as a small **Debug · recording** button. Recording continues while the panel is closed so the ball remains visible and the page can scroll freely. Open **Debug**, optionally **Reset** after the intro, then **Close** while scrolling. At the end, reopen **Debug** and use **Pause** for a screenshot, **Copy report** to paste the JSON, or **Save report** to attach it. The opt-in panel works on production as well as localhost. It distinguishes page RAF frequency, selected journey-frame updates, and native compositor callbacks when available; browser dropped-frame counters alone can miss seek stalls. Version 4 reports lag in source-video seconds, forward/reverse native seek timings separately from stationary confirmation, buffered time ahead of the current playhead, and playback activation failures. It also retains the latest 20 page pauses with journey/game context and, when supported, browser long-task/long-animation-frame evidence with limited script attribution. Unsupported performance APIs report null counters. Source seek totals are cumulative since page load; Reset clears the page recorder and observers. Empty browser frame counters are marked unavailable as evidence of smoothness; exports refresh current sequence state immediately. Worst gaps and frame lag persist until Reset, and reports include the last 120 half-second samples, decoder/cache state and device details. Hidden/paused time is excluded. Reports stay in the browser until explicitly copied or saved. Ordinary visits do not run the recorder.

For a controlled native-video comparison, run `SOFACET_PLAYWRIGHT_PATH=/path/to/playwright SOFACET_BROWSER=chromium SOFACET_CADENCE_OUTPUT=/tmp/cadence.json node scripts/browser-native-cadence.mjs` (or `SOFACET_BROWSER=webkit`). The test uses matched forward/reverse scroll speeds, real video-frame callbacks, native application RAF, and a phase-preserving 30 Hz application RAF cap. `SOFACET_CADENCE_REF=<full commit SHA>` loads a pinned baseline; `SOFACET_CADENCE_ENFORCE=1` turns the reported cadence goal into an assertion. CI enforces the cadence goal for the current build and saves baseline/current JSON artifacts for both engines; desktop runners do not establish physical-phone performance.

After creating the bucket and connecting its custom domain:

```sh
npx wrangler r2 bucket cors set "$R2_BUCKET" --file ops/r2-cors.json
R2_BUCKET=your-video-bucket npm run upload:videos
```

Uploads verify local hashes before writing immutable `videos/<sha256>/<filename>` keys with a one-year cache lifetime. `npm run upload:videos -- --dry-run` validates and prints the planned object uploads. Set `MEDIA_CDN_BASE_URL=https://your-media-domain` on the existing Railway service after uploading both files, then deploy normally. No Cloudflare credentials are exposed to the app or browser.

`npm run smoke -- https://your-app-domain` checks both variants, exact range lengths, CORS and exposed headers. A failed CDN range retries the same indexed file on Railway. To disable CDN delivery, clear `MEDIA_CDN_BASE_URL`. Publish new media objects before deploying a new manifest; retain older immutable objects while older app versions may still reference them.

## Verification and release checks

Automated tests cover score verification, scoring and target placement, membership validation, reward retry/idempotency rules, frontend state/copy, member-only leaderboard access, frame-cache bounds, video fallback behavior and verified video materialization from a separate deployment repository. Browser checks have covered desktop, phone and tablet layouts in Chromium and WebKit.

Before collecting memberships publicly, finish SMS and approved policies, test the live rewards connection, and verify the complete flow on physical Safari/iPhone devices. Automated WebKit checks do not replace real-device video, audio and touch testing.

## My Account

`account-source/` is the React sign-in and points page. The shared navigation links **My Account** to `account.html`; registration remains a separate flow for saving a new player's score. The existing brand artwork and navbar anchors are reused. Written brand names use the supplied wordmark font without changing surrounding typography.

An existing member session can read `GET /api/account`: `{name, phoneNumber, savedPoints, bestPoints, rank, marketingConsent}`. `savedPoints` represents confirmed game credits in the private reward ledger; it is not a live commerce balance. `POST /api/account/signout` expires the current browser cookie and retains saved records.

The backend account service still needs to connect these same-origin routes. They currently return 503 without sending messages or changing records:

- `POST /api/account/otp/request {phoneNumber}` → `{success, challengeId, expiresIn, resendAfter}`.
- `POST /api/account/otp/verify {phoneNumber, otp, challengeId}` → `{verified: true}` plus an authenticated HttpOnly session cookie. Verify account ownership on the server; the frontend confirms the session before showing points.
- `POST /api/account/details {name, phoneNumber}` → `{success: true}` only after persistence and any required phone re-verification.
- `POST /api/account/preferences {marketingConsent}` → `{success: true}` after saving the choice.
- `POST /api/account/delete {confirm: true}` → `{success: true}` only after the deletion policy is applied and the session is invalidated.

The frontend refreshes account data after changes and does not claim success on unconfirmed writes. OTP codes, account details and tokens are not persisted in browser storage. Score sharing uses the session's verified score. No preview OTP, sample balance or fabricated account state is included.
