# SO/ FACET

I’ve brought the landing journey, pinball game, registration and My points frontend together here for our backend handoff. The Node service verifies game scores and connects to the rewards backend. The default landing experience uses the live Three.js model; `/video` is retained for comparison.

I’ve kept the approved black, violet and lime theme, wordmark typeface and responsive layouts. Please keep the current game presentation and reward rules intact while connecting the remaining services below.

## Run locally

Use **Node.js 26**, npm and Git LFS. The server uses Node's native TypeScript support for shared game simulation code.

```sh
git lfs install
git lfs pull
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8766/` for the default Three.js entrance. `/entrance-3d` is an alias, `/play.html` opens the game, and `/video` opens the retained video comparison. Both entrance paths reuse the approved story copy, fonts, navigation and game loader. Production pages do not display developer inspection panels.

### Optional video of the current model

Use `/?entrance=1` and `/?entrance=2` for a comparison with neutral URL labels. Option 1 is the default live 3D entrance; option 2 uses the pre-rendered optimized model. This option includes the four-second ball assembly at the current doorway position and the complete scroll path through the queen impact. It retains the current scroll pacing, story copy, reverse scrolling, reduced-motion behavior and pinball handoff. Ordinary visits still use live 3D and do not download these videos; video visits do not download the entrance GLB or initialize its WebGL renderer.

Option 3, `/?entrance=3` (also `/?version=3`), selects native 3840×2160, 60 FPS video when `ENTRANCE_VIDEO_4K_MANIFEST_URL` is configured. Option 2 remains 1920×1080 and the default remains option 1. The `entrance` parameter takes precedence over `version`. Render with `npm run render:entrance-video -- --4k`, then package with `npm run prepare:entrance-cdn -- --4k`. The scene renders directly at 4K; no upscaling is used. CRF 18 delivery files are copied without another lossy encode and split into one-second sections. Outputs remain in ignored `work/entrance-video-4k/` for Cloudflare upload; 4K media is excluded from the application package.

Both video variants preload the full-quality opening and entire journey before scrolling starts. The initial loader shows download progress without a skip-to-pinball option. They no longer download or display the 512×288 motion preview, so moving frames keep the selected source detail. Option 3 downloads about 200 MB including its opening and sections; option 2 about 62 MB. At 20 Mbps, 200 MB alone takes about 80 seconds, before connection and decode overhead. The CDN still hosts the same immutable video files; no re-render, upscaling or quality reduction is involved.

Preloading removes network waits during a healthy journey, but does not guarantee 60 displayed frames per second. Decoding remains device-dependent. Retention stays limited to three decoded 4K pictures, matching the pixel budget of twelve 1080p pictures; the whole movie is kept compressed, not as thousands of decoded images. If the 4K manifest is unavailable, it tries the regular CDN and bundled 1080p clips. Failed preloading retries the full bundled 1080p movie before releasing the loader. A playback failure can also fall back to bundled 1080p; diagnostic `sourceWidth` and `sourceHeight` report the actual painted resolution. Use `SOFACET_ENTRANCE_OPTION=3 SOFACET_EXPECT_ENTRANCE_WIDTH=3840` for the video browser check, or `SOFACET_OPTIONS=3 SOFACET_EXPECT_ENTRANCE_WIDTH=3840` for the motion check. `SOFACET_ENTRANCE_PARAMETER=version` checks the URL alias. A successful emulated run does not certify physical-phone 4K performance.

The Full HD, 60 FPS H.264 clips and their source/encoding manifest live in `assets/entrance-video/`. They are rendered deterministically from `journey-compact.glb` with the current Three.js materials, reflections and camera data. They are **not a new Blender/Cycles render**: the saved Blender snapshot predates the current website framing and materials. Compressed video uses browser decoding and coalesced precise seeks, rather than the legacy all-IDR worker. Physical-phone smoothness still needs device validation.

To regenerate, install FFmpeg and provide a Playwright installation with Chromium:

```sh
SOFACET_PLAYWRIGHT_PATH=/absolute/path/to/playwright npm run render:entrance-video
npm run build:entrance
SOFACET_PLAYWRIGHT_PATH=/absolute/path/to/playwright SOFACET_BROWSER=chromium node scripts/browser-entrance-video.mjs
```

Use `npm run render:entrance-video -- --preview` to inspect six representative frames before a full render. `npm run encode:entrance-video` recompresses the saved master clips without rendering the scene again. High-quality intermediate movies and verification captures stay in ignored `work/entrance-video/`; only the web clips, poster and manifest are served. The exporter samples every authored frame, so rendering delays do not become dropped frames in the movie. The existing `/video` assets and independent-frame index are unchanged.

To serve the saved renders from Cloudflare, run `npm run prepare:entrance-cdn`. It stream-copies the sequential opening and encodes the complete 1080p/60 FPS journey at CRF 20, with a keyframe every 12 frames and no B frames, then stream-copies it into two-second sections. This delivery encode is 59.3 MB versus 215.6 MB for the earlier CRF 10 / four-frame version: compression increases, while resolution, frame count and animation remain unchanged. The original masters remain in ignored `work/entrance-video/`. The script also creates a 512×288 motion preview (4.4 MB) with the identical 60 FPS timeline. It verifies frame timing, Rec.709 metadata and sample offsets, and writes content-addressed files to `work/entrance-video/cdn/`. Upload the opening, full journey, every section and motion preview, then the manifest, to the existing public R2 bucket. Verify hashes, byte ranges and browser playback before setting `ENTRANCE_VIDEO_MANIFEST_URL` to the immutable HTTPS manifest. These are encodes of the existing Three.js render; no large CDN media enters Git or the Railway deployment.

Three concurrent downloads fill a bounded 256 MiB compressed-media store before the entrance is ready. The current variant remains available for both forward and reverse scrolling, even after the decoder evicts distant sections. An optional 256 MiB disk cache avoids repeat downloads; unavailable storage or quota errors do not prevent playback. Progress-based timeouts tolerate slow active downloads, and leaving cancels pending work. All blob URLs and decoded frames are released on game handoff.

Where WebCodecs is available, indexed prediction groups decode from this preloaded store. Unsupported or failed explicit decoding uses native video with buffered section blobs. Completed sharp frames are painted while newer scroll targets are queued; obsolete frames outside the path toward the latest target are discarded on reversal. The responsive crop and copy follow the painted frame, and game handoff still waits for the exact final frame.

The Option 2 renderer uses the external manifest only when explicitly configured and falls back to the bundled clips if CDN configuration or playback fails. `/api/media-config` exposes only the public manifest URL; Cloudflare credentials stay outside the app. `MEDIA_CDN_BASE_URL` still configures the separate legacy `/video` path. Clearing `ENTRANCE_VIDEO_MANIFEST_URL` restores local delivery. Option 1 remains the homepage default. Larger media still costs visitors bandwidth, and keyframe spacing still affects seek latency; CDN hosting does not guarantee smoothness on physical phones.

The responsive video crop, story copy, progress and sound follow the frame actually painted to the canvas. Run `scripts/browser-entrance-motion.mjs` with `SOFACET_CHECK_MOTION=1` to check crop alignment and monotonic presentation. `SOFACET_MOTION_CHESS=1` covers the entire chess room; `SOFACET_MOTION_FAST_FIRST=1` runs the fast passes before warming the cache. Chromium additionally accepts `SOFACET_NETWORK_MBPS=20` and `SOFACET_CPU_RATE=4`. Set `SOFACET_DEVICE='Desktop Chrome'` or an installed Playwright phone descriptor. Reports in `work/entrance-motion/` include update gaps, request timing and minimum painted source width; moving and stopped frames must retain full resolution. `SOFACET_OFFLINE_SCROLL=1` disconnects the browser after preload to verify the entire tested scroll path needs no additional media downloads. Use `SOFACET_MAX_VIDEO_STALL_MS` only for controlled performance comparisons; hosted-runner or emulated-device timing does not certify physical-phone performance.

To measure the live 3D homepage, open `/?debug=1` (`/?debug/1` is also supported). Its opt-in FPS panel counts rendered scene updates during assembly and scrolling, shows resolution and draw calls, and offers **Run 10s check** for average FPS, slowest one-second FPS and p95 frame intervals. Close it with × and reopen with **Show FPS**. The panel hides when entering pinball; it measures the 3D journey, not game FPS. Ordinary homepage visits do not create the panel or its sampling timer.

The default entrance renders the ball assembly and scrolling journey in the same Three.js scene. It starts at the closer doorway composition (source frame 334). The authored assembly poses are cached and relocated to that position before playback. The logo loader waits for the assets, poses and real GPU warm-up, pulsing if preparation outlasts its reveal. A first swipe can enter the journey immediately; the outdoor approach and empty chessboard both use half the original scroll distance. Reduced motion starts at the assembled pose. The default entrance does not create a video element or request an opening video, and backgrounding pauses its assembly clock.

For local configuration, copy `.env.example` to `.env` and fill in values privately. The game can run without rewards credentials; registration and reward saving require the services described below.

### iOS entrance rendering

iPhone and iPad automatically use the mobile rendering profile. It caps the main buffer at 1× CSS resolution, applies FXAA after the existing HDR/bloom/colour pipeline, and uses smaller single-sample reflection targets. The original model, animation and camera framing are retained; fine edges and secondary reflections are softer. Android and desktop retain their existing resolution and antialiasing settings. `?quality=mobile` forces the mobile profile for comparison; `?quality=desktop` and `?quality=reference` retain comparison paths. Use the browser performance check below to inspect the selected profile and frame timings.

The animated ball uses a single draw per material on mobile and wherever `WEBGL_multi_draw` is unavailable. Vertex transform IDs preserve all source facet geometry and animated transforms without Three's per-object multi-draw fallback. Gallery mirror captures now use the same simplified reflected-glass materials as the other mirrors, avoiding a separate full-scene transmission render inside each mirror. Inactive room lights also skip shading in the facade and water's custom shaders.

On 27 October 2026, sequential 10-second full-journey checks at a 393 × 852 CSS viewport and DPR 3 on macOS browser runners measured:

| Runner | Previous first / repeat average | Mobile first / repeat average | Previous slowest 1s, first / repeat | Mobile slowest 1s, first / repeat |
| --- | --- | --- | --- | --- |
| WebKit 26.6, Apple GPU | 42.5 / 45.0 FPS | 58.3 / 58.2 FPS | 18 / 29 FPS | 52 / 52 FPS |
| Chromium, Apple M4 / ANGLE Metal | 43.4 / 44.2 FPS | 58.5 / 59.5 FPS | 23 / 27 FPS | 48 / 57 FPS |

Both mobile-profile runs met the measured 45 FPS one-second-window floor, with no shader or JavaScript errors. These runners do **not** reproduce the reported physical iPhone 5–6 FPS, and their results are **not** iPhone certification. Both runners support multi-draw; they do not establish missing multi-draw as the cause on the reported devices. Before release, repeat the journey on the affected iPhone 15, 15 Pro and 16 Pro with device profiling, including a repeat run, reverse scroll and orientation change. FPS counts submitted scene updates, not verified display scanout.

Build the production entrance with `npm run build:entrance`. For repeatable browser checks against a running local server:

```sh
SOFACET_PLAYWRIGHT_PATH=/absolute/path/to/playwright SOFACET_BROWSER=webkit SOFACET_ENTRANCE_URL=http://127.0.0.1:8766 node scripts/browser-entrance-smoke.mjs
```

The smoke check uses an iPhone user agent to verify automatic profile selection, checks scrolling and shaders, and saves its measurements in `work/entrance-performance`. Set `SOFACET_MIN_FPS=45` to enforce the one-second-window floor on a controlled runner. A desktop viewport or iPhone user-agent emulation cannot substitute for the physical-device check.

For ZIP downloads, skip the two `git lfs` commands above. If the archive contains a Git LFS pointer instead of the full video, `npm run build` downloads the approved video and verifies its size and SHA-256 before using it. Internet access to the public media mirror is required for that first build; an already materialized video is reused.

```sh
node --test --test-concurrency=1 tests/*.test.mjs
npm run smoke
```

Tests use temporary storage and synthetic services. The local smoke check starts an isolated server, checks page assets and video streaming, and removes its temporary player data afterward.

## Project structure

| Location | Responsibility |
| --- | --- |
| `entrance-source/`, `entrance-3d.html`, `assets/entrance-3d/` | Default Three.js journey, camera/light data and game handoff |
| `index.html`, `style.css`, `viewer.js`, `sequence.js` | Shared presentation source and video comparison at `/video` |
| `assets/landing-copy.js`, `assets/kinetic-copy.js` | Configurable story copy, frame ranges and masked text transitions |
| `navigation.js`, `assets/navigation.css` | Shared brand placement, hamburger and navigation drawer |
| `game-source/` | Three.js table, Rapier physics, controls, scorecard, leaderboard and rewards screen |
| `membership-source/` | React registration, phone verification, validation and save/leave flows |
| `faq-source/`, `about-source/` | React informational pages, including the Explore collection gallery |
| `account-source/`, `shared/` | React account flow and shared brand text |
| `server.mjs`, `verify-game.mjs`, `replay-worker.mjs` | Same-origin API, player sessions and score verification |
| `membership-api.mjs`, `membership-otp.mjs`, `rewards.mjs` | Membership, rewards OTP integration and external rewards adapter |
| `scripts/`, `tests/` | Builds, deployment checks and automated tests |
| `assets/`, `sounds/`, `vendor/`, `leaderboard/`, `references/` | Runtime media, exported table data and bundled dependencies |
| `licenses/` | Third-party license and audio attribution notices |

`npm run build` checks TypeScript and rebuilds the frame index, game and all React pages. Generated `play.html`, `membership.html`, `faq.html`, `about.html`, `account.html` and their browser bundles are included. Edit the corresponding source directory and rebuild instead of editing generated pages.

## Experience and gameplay

- The landing reveal leads into the interactive scroll journey. Story text is tied to its approved frame ranges. The welcome copy stays visible until scrolling starts, fades out over one second and returns when the player scrolls back to the starting position. I’ve restored the lime tagline to “LAB-GROWN DIAMOND REDEFINED”; it stays on one line on desktop and two lines on mobile. Reduced-motion mode switches immediately.
- I’ve extended the landing loader to eight messages, shown one at a time while the 3D world prepares. They repeat on slower loads and stop as soon as the scene is ready; visitors don’t have to wait for all eight. The SO/ FACET name keeps our wordmark typeface in the loading copy.
- The queen impact at source frame 2164 hands directly into the game. Play Pinball bypasses the journey.
- The chess-to-game transition keeps the moving ball and shows two messages in sequence: “Next: a game of pinball.” and “Score points. Save them for SO/ FACET diamond jewellery.” The text is white, regular-weight and at least 20px. The table opens after the final message and actual game readiness; reduced motion uses static text.
- Skip game opens `launching-soon.html`. The launch page links to the existing React join form with `from=first-cuts`, and also offers Play Pinball. The confirmation page has Play Pinball and Back to the world actions.
- The shared menu contains Play Pinball (Back to game in game context), My points, How points work, About SO/ FACET and Join THE FIRST CUT. Terms and Privacy remain unavailable pending approved content. I’ve connected the official LinkedIn, X and YouTube links; each opens in a new tab. Instagram and Facebook remain unlinked until I provide their URLs. The mobile drawer uses compact spacing. Its footer links and the five social icons are centered in separate rows, with equal spacing and no frames around the icons. Settings is available from the game controls rather than the drawer, and My points replaces the old profile panel.
- Rewards and confirmation screens use SO/ UNLOCKED and SO/ SAVED, with Play again as the replay action. THE FIRST CUT is singular throughout. Score sharing and its selectable fallback keep the same reward rules. The score screen also links to the existing full leaderboard; its current membership requirement is unchanged.
- I’ve rebuilt the post-game score screen in React using the approved fonts, ribbon artwork and our shared navbar. The desktop text and actions fit within the agreed layout; the latest spacing, size and brightness adjustments apply only to desktop. It uses the completed game result and game ID, keeps the existing 10 points = ₹1 conversion, and calls the same registration, replay and leaderboard handlers. Low scores and the unsaved-points exit check retain their current behavior.
- Registered players skip membership screens and can open the leaderboard. Unregistered players enter registration before any leaderboard request; both leaderboard API routes enforce membership.
- The table includes two decorative diamonds on open cradles. Positive scoring turns them gently; reduced motion keeps them still. These decorations have no collision bodies. All quality modes retain the authored lights. Handhelds use a transparent, reflective tunnel canopy without the whole-table transmission pass; desktop retains physical refraction. Full keeps the same pixel density on phones while using FXAA instead of multisampled HDR buffers.
- New visitors start at Full board resolution (up to 1.5× pixel density); explicit saved quality choices are retained. After a short warmup, at least two seconds of consistently sub-30 FPS gameplay switches Full to Auto and lowers resolution one small step. Loading, launcher idle, pauses, menus, practice and hidden tabs do not count. The fallback is session-only, so it does not overwrite a saved preference. Auto recovers detail with sustained headroom, keeps at least one render pixel per CSS pixel through 4K viewports, and bounds larger buffers to 4K total pixels. The explicit Low setting retains its smaller buffer. Actual frame rate depends on the device.
- Portrait phone play uses a 96px launch/score panel with padding inside the score boxes and a slightly more overhead camera. The canvas height retains the former pixel budget on short phones and is bounded by the board width on tall screens, avoiding extra render pixels for empty space. Lighting, materials, resolution profiles and physics are unchanged. Game UI updates only when its values change; charge feedback remains frame-paced. Resize notifications are coalesced and unchanged buffers are reused.
- Triangle housings and their luminous strips count one scoring hit until the ball separates. Sliding along the same triangle cannot repeatedly earn points; a fresh hit after separation still scores normally.
- Phone and tablet layouts flip between Hold to launch and the live scorecard as the ball launches and returns. Desktop retains the keyboard instructions and flip card, with a Hold button below the card. Only one flipper accepts input at a time; the held flipper keeps priority until released. Sound controls respect browser activation requirements.
- Mobile and desktop show diamond-heart life indicators with a centered Lives label in Biarty Medium. They track the actual remaining balls, stay within the game layer and sit behind the navigation drawer. Pause/resume shares one rotating icon, with restart and settings alongside it. The practice guide covers the two flippers before the game starts; its supporting note is at least 13px.
- Membership Back returns to the landing experience without replaying the intro loader. Registration steps still move back within the form.
- The About page uses the approved Explore layout with scroll reveals and a keyboard-accessible collection gallery. The shared navbar and current-page menu behavior apply there as well.
- Game rewards display `pts`; the conversion remains **10 points = ₹1**.

| Table interaction | Score |
| --- | ---: |
| SOFACET letter target | +1,000 |
| Triangular block | +100 |
| Ring block | +50 |
| Cyan bumper | −500 |
| Neon green bumper | +500 |
| Drum base bumper | +200 |
| Launcher | 0 |
| Cave | +400 |

The score cannot fall below zero. A negative bumper deducts up to 500 points from the current total without carrying a negative balance into later hits.

Scoring is shared between the client simulation and server replay verification. Keep replay versions, collision data and simulation parameters in sync when changing gameplay.

## Backend integration

### Sessions and verified scores

`GET /api/player` supplies the current player's authoritative state using an HttpOnly session cookie. Membership recognition currently applies to that browser session; cross-device login is a separate backend requirement.

The client starts a game with `POST /api/games/start`, then submits its replay version and packed control inputs to `POST /api/games/:id/finish`. The shared simulation is now replay version 23. Deploy the frontend and verification service together; sessions started on an older version must start a fresh game after updating. The server replays those controls against the shared simulation and records the score. Do not accept client-supplied scores or redeemable reward amounts.

All writes require JSON and the configured exact Origin. Keep the frontend and API on the same origin unless the session and origin model is deliberately updated.

### Membership contracts

| Endpoint | Request / response |
| --- | --- |
| `GET /api/membership/config` | Public OTP availability, approved policy URLs and `pointsPerRupee: 10` |
| `POST /api/membership/otp/request` | `{phoneNumber, name, consent: true, dateOfBirth?}` → `{success, challengeId, expiresIn, resendAfter, deliveryChannel}` |
| `POST /api/membership/otp/verify` | `{phoneNumber, otp, challengeId}` → `{verified, verificationToken}` |
| `POST /api/membership` | `{name, leaderboardName, email, termsAccepted, marketingConsent, phoneNumber, verificationToken, gameId?}` → player and saved-reward status |
| `POST /api/membership/rewards` | Existing member with a verified, unexpired rewards session sends `{gameId}` → `{success, pointsSaved, savedPoints, bestPoints, remainingPoints}` |
| `GET /api/leaderboard` | Member-only game ranking with `entries` and `me` |
| `GET /api/rewards/leaderboard` | Member-only external rewards ranking; requires rewards configuration |

The legacy phone-only `/api/member` route returns 410. Use `/api/membership` after OTP verification; there is no phone-only authentication fallback.

The save-points form has one **Full name** field, **Mobile number** and **Email**. Its initial leaderboard name is derived from the full name. Saving requires the 18+ declaration, accepted terms and confirmed phone verification. Marketing consent is optional and defaults off on this form. The country list places India first, with the remaining countries alphabetical. Date of birth and city are not collected by this frontend.

The OTP verification token is a short-lived internal proof bound to the current session, phone and registered name/date of birth. It is not the external rewards JWT. Form details, codes and verification proofs are not persisted in browser storage. The upstream JWT stays in server memory until expiry; a process restart or expired/invalid JWT requires a new OTP. The game opens the verification form again while retaining the completed game. Keep this service on one process with persistent player/game/award storage, as described above.

### Remaining service connections

1. **Rewards OTP:** `membership-otp.mjs` connects the SO FACET rewards API using the server-only `REWARDS_API_KEY` and `REWARDS_API_BASE`. The API delivers WhatsApp or SMS codes and issues the JWT only after verification. Sends are never automatically retried. Respect the returned resend delay (at least 60 seconds), `Retry-After`, five-minute expiry and five-attempt limit. A 502 delivery failure creates no local membership or credits. The supplied integration guide reports a Meta sender approval restriction; confirm actual delivery with a consenting phone before launch. No key or live phone is included in this repository.
2. **International phone support:** the frontend normalizes international numbers to E.164. Server phone validation currently accepts Indian `+91` numbers only. Extend server validation and provider coverage together before enabling additional countries.
3. **My points:** OTP sign-in and full Medusa profile reads/updates are connected. Account deletion remains unconnected. Name and leaderboard-name updates are handled from My points; the old profile panel is no longer in the menu.
4. **Approved policies:** Terms and Privacy content was left out pending approval. Set `MEMBERSHIP_TERMS_URL` and `MEMBERSHIP_PRIVACY_URL` to the approved HTTPS URLs. Registration currently refuses completion without them. The existing Terms and Privacy pages are explicitly labeled temporary placeholders. Production currently links to `/terms.html` and `/privacy.html` as requested; replace their content with the approved policies before public launch.
5. **Commerce redemption:** apply the approved redemption cap, exclusions and expiry in the commerce backend when the shop opens. The frontend explains these rules; it does not enforce order eligibility.
6. **Tracking:** I haven’t supplied Meta or Google identifiers yet. Connect them when the approved identifiers and consent requirements are available.
7. **THE FIRST CUT early-access signup:** the join form already exists at `/membership.html?from=first-cuts`. It collects full name, mobile number and email, with required 18+/Privacy and updates/early-access consent. Submission is currently blocked in the frontend: the existing account API records Terms consent, which this list form does not request. Please provide a separate list-signup contract that records these displayed consents, then connect the form and show the existing confirmation page only after the server confirms success. Do not map Privacy acceptance to `termsAccepted` or grant game rewards for joining the list.

### Rewards adapter

The documented rewards service is called only by the Node backend:

- `POST /rewards/auth` submits phone, explicit verification-message consent and supported profile fields, creating an unverified registration and requesting a code. It does not issue a JWT.
- `POST /rewards/auth/verify` exchanges that registration ID and six-digit code for a customer rewards JWT.
- `GET /rewards/score` validates the resulting customer session before the browser receives an internal verification proof.
- `GET/POST /rewards/profile` reads and persists native Medusa name/email plus leaderboard name, marketing choice, 18+ declaration and policy consent metadata. Registration waits for this write before awarding points.
- `/rewards/points` receives server-calculated credits with the verified JWT and a stable idempotency key. It never requests a new token silently.
- `/rewards/leaderboard` supplies the optional rewards ranking.

**One upstream reward unit is ₹1; ten game points are ₹1.** A verified 3,200-point result therefore grants 320 upstream units. Only improvement over the customer's previous best earns additional credit. Retries reuse the pending award's key, and replays of lower scores do not grant credits. Remainders below ten points stay recorded without rounding upward.

The private reward ledger is keyed by the upstream customer ID. Keep it persistent, along with player and game records. The protected internal award endpoint requires `REWARDS_ADMIN_SECRET` and `{token, points, eventId}`, using an already verified, unexpired rewards JWT; it is not a browser API.

The v2.2 rewards contract adds a JWT-scoped profile API. Name/email persist on the existing Medusa customer; game-specific public name and consent records persist under customer.metadata.pinball_profile. Optional date of birth/city from older clients are forwarded; the current form does not collect nationality. The game retains the Medusa customer ID, verified phone reference and public display name, plus gameplay and idempotency records. It removes its duplicate private profile fields after a confirmed central save/read. Legacy local profiles migrate only after fresh OTP verification and only if Medusa has no complete profile. Existing central edits are never overwritten by that migration. Rewards JWTs still do not authorize unrelated storefront endpoints or create storefront sessions.

Run `npm run test:rewards` for local HTTP contract tests and `npm run smoke:membership` after rebuilding the membership and game pages for browser checks (requires Playwright, optionally via `SOFACET_PLAYWRIGHT_PATH`; `SOFACET_BROWSER=webkit` selects WebKit). These use an isolated rewards fixture and never send production messages or award production balances. A live acceptance test still requires a securely configured partner key, approved policy URLs, a consenting +91 phone and the received OTP. Check score before awarding real points.

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

The main GitHub Actions workflow runs build, unit, smoke and Chromium/WebKit Three.js entrance checks on pull requests and pushes to `main`. The retained video-performance benchmarks run separately from `.github/workflows/video-performance.yml` on demand. Railway's existing GitHub repository integration handles production deployments from the connected `main` branch. The workflow does not run a second Railway CLI deployment or require a `RAILWAY_TOKEN` secret. Enable Railway's **Wait for CI** service setting when automatic deployment should wait for these checks to pass.

The configured service URL is `https://facet-pinball-production.up.railway.app`; `shopsofacet.com` still requires the corresponding DNS configuration. `/health` is a read-only readiness endpoint. After deployment, `npm run smoke -- https://facet-pinball-production.up.railway.app` verifies the public site and streamed media.

I've kept the video download tied to an exact revision of our public `sofacettech/Pin_ball_Game` media mirror. It does not use the deployment repository's `RAILWAY_GIT_COMMIT_SHA`, so builds from a separate repository or ZIP export can retrieve the same approved video. The download replaces the LFS pointer only after the committed SHA-256 and size match. If we replace the video, please update the pinned mirror revision in `scripts/materialize-video.mjs` together with the LFS object, frame index and media manifest. A private mirror would require an authenticated server-side download path.

The on-demand video-performance workflow also fetches its fixed comparison baseline from `sofacettech/Pin_ball_Game`, independently of the checkout's `origin`. Keep that baseline available in the public mirror when moving the application to another repository. Hosting credentials belong in the service environment; neither download path needs a password in source control.

Keep the service at **one replica** with persistent `DATA_DIR` storage. The current atomic file store is designed for one process. Move player, score and reward state to shared transactional storage before running multiple replicas.

### R2 video delivery

The app, APIs, frame index and fallback media remain on Railway. When configured, the two public MP4 files are served through an R2 custom domain. Use a dedicated bucket; `ops/r2-cors.json` permits public GET/HEAD requests and exposes the byte-range headers required by the frame decoder. The production delivery URL must be a custom domain, because `r2.dev` does not provide CDN caching.

Desktop and mobile share a high-quality 1920×1080 H.264 encode at 60 FPS, retaining all 1,990 journey frames and the same camera, copy, sound and game handoff timing. The all-IDR encode uses x264 slow / CRF 16, Rec.709, YUV420p and faststart. It is visually close to the original, not mathematically lossless: 171,078,178 bytes versus 248,630,827 bytes (31.2% smaller), with full-sequence SSIM 0.995112 against the original after timestamp normalization. No resizing or frame-rate reduction is applied. Mobile optimizations bound download concurrency and decoded-frame memory; grouped byte-range requests and directional prefetching reduce stalls. No HLS/Stream transcoding is used: every scroll frame must remain independently decodable and match its byte index.

On desktop, Safari's native decoder can retain immutable full-resolution `VideoFrame` surfaces. The mobile cache retains at most four frames (about 32 MiB as RGBA), plus one in-flight decode, prioritizes frames in the scroll direction, and releases frames when the page is hidden. Buffered frames are presented in the animation loop alongside scene placement and copy. Touch devices and older browsers without `VideoFrame` use the native video compositor while scrolling. Once the requested destination and frame queue are idle, the timestamp-confirmed frame is captured into the existing canvas to preserve stable pixels after WebKit pauses. Resuming scroll cancels an obsolete confirmation; intermediate frames avoid full-size canvas copies. Native pacing adapts to slow seek completion: large swipes skip obsolete intermediate samples and ease toward the latest scroll target instead of accumulating a long four-frame-step backlog. Nearby movement keeps small steps. Native motion requests use a 30 Hz deadline scheduler independent of page RAF only while the verified all-IDR `fastSeek` path remains accurate: a completed seek can start the next due request without losing another screen refresh, while useful pending work remains single-flight. Small timer delays retain the 30 Hz phase instead of accumulating drift. Moving fast-seeks wait for a matching compositor acknowledgment before releasing the next seek, bounded to one additional 30 Hz interval when paused-video callbacks are missing; wait time and fallback counts are exported in Debug. Slow seeks do not build a burst of missed timer work, and idle/hidden pages stop the scheduler. Browsers using precise `currentTime` seeking retain responsive RAF pacing; an inaccurate or failed `fastSeek` switches back to that path immediately. Decoded data and playback permission are tracked separately; if a browser blocks settled playback, a Tap to resume journey control activates the video directly inside the gesture and retries confirmation without reloading the buffer. The WebKit release check compares rendered pixels with the selected native video and measures continuous forward/reverse scrolling against the previous renderer on the same runner; source FPS is not a guarantee of rendered FPS on a physical phone.

After the opening, the live 43-plate ball loops its authored split poses in a wave while a bounded opening buffer warms. The gate requires a decoded first frame and three seconds of native buffering (or the native HAVE_ENOUGH_DATA signal, because Safari caps paused prefetch). WebCodecs prepares up to 360 compressed samples on desktop or 57 on constrained devices, within 75% of a 48 MiB desktop / 10 MiB constrained-device budget. Desktop retains up to 512 compressed frames and eight decoded images, including 224 frames of reversal history. The window shrinks near the ending instead of downloading extra old history, and immediate playback ranges take priority over distant swipe destinations. It never downloads the entire movie into JavaScript memory or retains all decoded frames. Changing copy, real buffer progress, retry and Play Pinball remain available; reduced motion disables the wave. This initial buffer cannot guarantee stall-free playback on every network or device. Game iframe initialization starts only once the final cinematic frame is settled; the game loader covers any remaining handoff wait so game startup does not compete with the ending.

Run `npm run build:frames` after changing source media. It checks Full HD dimensions, 60 FPS, colour metadata and an IDR in every frame, then generates the matching manifest and content hashes. The manifest intentionally maps both device profiles to the same Full HD files.

Touch devices keep the scene at a stable large viewport height while browser bars resize the controls. Native video uses `object-fit: contain` inside the 16:9 stage so viewport changes cannot stretch the ball. The WebGL backing buffer is capped at Full HD, and the journey canvas is allocated on its first draw and released on exit. With a local server running, `SOFACET_VIDEO_URL=http://127.0.0.1:8768 node scripts/browser-mobile-geometry.mjs` checks portrait, landscape and simulated browser-bar changes with automatic and forced native playback.

To capture a physical phone's scroll performance, open the site with `?perf=1`. It starts as a small **Debug · recording** button. Recording continues while the panel is closed so the ball remains visible and the page can scroll freely. Open **Debug**, optionally **Reset** after the intro, then **Close** while scrolling. At the end, reopen **Debug** and use **Pause** for a screenshot, **Copy report** to paste the JSON, or **Save report** to attach it. The opt-in panel works on production as well as localhost. It distinguishes page RAF frequency, selected journey-frame updates, and native compositor callbacks when available; browser dropped-frame counters alone can miss seek stalls. Version 4 reports lag in source-video seconds, forward/reverse native seek timings separately from stationary confirmation, buffered time ahead of the current playhead, and playback activation failures. It also retains the latest 20 page pauses with journey/game context and, when supported, browser long-task/long-animation-frame evidence with limited script attribution. Unsupported performance APIs report null counters. Source seek totals are cumulative since page load; Reset clears the page recorder and observers. Empty browser frame counters are marked unavailable as evidence of smoothness; exports refresh current sequence state immediately. Worst gaps and frame lag persist until Reset, and reports include the last 120 half-second samples, decoder/cache state and device details. Hidden/paused time is excluded. Reports stay in the browser until explicitly copied or saved. Ordinary visits do not run the recorder. Version 6 excludes settled gesture pauses from stall counts and adds bounded stall episodes with requested/ready/drawn evidence. Opt-in worker stage timings include recent p95 and lifetime mean/max; first-draw timings include cache residence and do not prove physical display presentation. Closing the panel also stops hidden UI formatting while recording continues.

For a controlled native-video comparison, run `SOFACET_PLAYWRIGHT_PATH=/path/to/playwright SOFACET_BROWSER=chromium SOFACET_CADENCE_OUTPUT=/tmp/cadence.json node scripts/browser-native-cadence.mjs` (or `SOFACET_BROWSER=webkit`). The test uses matched forward/reverse scroll speeds, real video-frame callbacks, native application RAF, and a phase-preserving 30 Hz application RAF cap. `SOFACET_CADENCE_REF=<full commit SHA>` loads a pinned baseline; `SOFACET_CADENCE_ENFORCE=1` turns the reported cadence goal into an assertion. CI enforces the cadence goal for the current build and saves baseline/current JSON artifacts for both engines; desktop runners do not establish physical-phone performance.

After creating the bucket and connecting its custom domain:

```sh
npx wrangler r2 bucket cors set "$R2_BUCKET" --file ops/r2-cors.json
R2_BUCKET=your-video-bucket npm run upload:videos
```

Uploads verify local hashes before writing immutable `videos/<sha256>/<filename>` keys with a one-year cache lifetime. `npm run upload:videos -- --dry-run` validates and prints the planned object uploads. Set `MEDIA_CDN_BASE_URL=https://your-media-domain` on the existing Railway service after uploading both files, then deploy normally. No Cloudflare credentials are exposed to the app or browser.

`npm run smoke -- https://your-app-domain` checks both variants, exact range lengths, CORS and exposed headers. A failed CDN range retries the same indexed file on Railway. To disable CDN delivery, clear `MEDIA_CDN_BASE_URL`. Publish new media objects before deploying a new manifest; retain older immutable objects while older app versions may still reference them.

## Verification and release checks

For the board regression check, run `SOFACET_GAME_URL=http://127.0.0.1:8766 SOFACET_PLAYWRIGHT_PATH=/path/to/playwright node scripts/browser-game-performance.mjs` against a built local server; repeat with `SOFACET_BROWSER=webkit`. The check covers portrait sizing, unchanged-UI mutations, launch/charge, pause/resume, quality selection, scores, restart and rotation. An optional `SOFACET_GAME_BASELINE=/path/to/previous-play.html` compares a previous HTML build whose assets are still available on that server. `SOFACET_GAME_DEV_URL` can point to a local game Vite server to check render-target sizing and reuse. Results and screenshots are saved under `work/game-performance`. Emulated phones validate behavior and layout, not physical-device FPS.

With the same environment variables, `node scripts/browser-game-quality.mjs` adds controlled frame delays to verify Full startup, the sub-30 FPS Auto fallback during ball play, paused/idle exclusions, and preference retention. Run it in WebKit and Chromium; its artificial slowdown is not a device benchmark.

Automated tests cover score verification, scoring and target placement, membership validation, reward retry/idempotency rules, frontend state/copy, member-only leaderboard access, frame-cache bounds, video fallback behavior and verified video materialization from a separate deployment repository. Browser checks have covered desktop, phone and tablet layouts in Chromium and WebKit.

Before collecting memberships publicly, configure the rewards key and approved policies, test actual OTP delivery and the live rewards connection, and verify the complete flow on physical Safari/iPhone devices. Automated WebKit checks do not replace real-device video, audio and touch testing.

## My points

`account-source/` contains the React sign-in and saved-points page. A guest opening My points sees sign-in; an existing authenticated session sees its real points and details. The sign-in page links new players to Play Pinball. There is no public demo-code sign-in path. Links opened from game context retain `nav=game`, and Back to game closes the current drawer without restarting an active game.

I’ve kept registration separate from sign-in. The save-points form uses the WhatsApp or SMS confirmation flow, and confirmed points remain tied to the server-verified game. The early-access list form has different consent requirements, as noted above.

A verified rewards session can read `GET /api/account`: `{name, leaderboardName, email, phoneNumber, savedPoints, bestPoints, rank, marketingConsent}`. Profile fields are fetched from Medusa. `savedPoints` is Medusa's current spendable balance converted to game-point units; `bestPoints` and rank remain game results. Expired/missing JWTs require OTP sign-in. `POST /api/account/signout` invalidates the in-memory JWT and verification proofs and expires the browser cookie while retaining saved records.

`POST /api/account/details {name, leaderboardName, email, phoneNumber, marketingConsent}` validates the signed-in user's fields and forwards them to `POST /rewards/profile` using that user's verified JWT. Medusa persistence is required before success is returned. Phone changes are rejected. Email conflicts return a useful error; provider failures never fall back to a local-only save. Points are not awarded by edits.

- `POST /api/account/otp/request {phoneNumber}` requests a real WhatsApp/SMS code through rewards authentication, without changing legal or marketing consents.
- `POST /api/account/otp/verify {phoneNumber, otp, challengeId}` verifies the code, reads the existing Medusa profile and binds its customer to the current HttpOnly session. A new phone without a complete profile must use the registration form.
- `POST /api/account/delete {confirm: true}` remains unconnected (503); it must eventually delete through the central service and invalidate the session. The UI requires typing DELETE before submitting.

The separate `/api/account/preferences` placeholder is retained; the current account form saves `marketingConsent` through the implemented details request. Please keep those writes consistent if both routes are implemented.

The frontend refreshes account data after changes and does not report unconfirmed server writes as saved. OTP codes and verification tokens are not persisted in browser storage. Score sharing uses the account’s confirmed best score. Play again and Share my score remain available from My points.
