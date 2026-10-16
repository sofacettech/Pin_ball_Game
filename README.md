# SOFACET website and pinball game

This website includes the cinematic landing sequence and the current pinball game from the page previously running on port 5173, including the latest 0.18-second “Hitting flaps” sound used by both flippers.

## Run

Use Node.js 24 or later; the package was built and checked with Node.js 26.

```sh
cd "$HOME/Desktop/SOFACET-Website"
npm ci
npm start
```

Open http://127.0.0.1:8766/. Stop another preview on that port before starting this copy. The compiled game is included, so the initial local preview does not require a build.

After changing the game source:

```sh
npm run build
npm start
```

The build checks TypeScript and regenerates `play.html` and the game's compiled JavaScript/CSS in `assets/`. Landing-page HTML/CSS/JavaScript can be edited directly. Keep the supplied runtime assets and relative paths intact.

## Connected experience

1. Clip 1 plays automatically, then the real Three.js ball holds for hover interaction.
2. Scrolling controls Clips 3–6 at the confirmed 8 pixels per source frame (1.5× rate).
3. Only after the final rendered frame, Blender frame 2229, is displayed, the complete scene fades to black over two seconds.
4. The actual pinball page then fades in in the same viewport, ready to play. The game begins loading during the black fade. Its existing loading progress appears if it needs more time. The iframe keeps the two Three.js versions and page styles separate and uses local files on the same website; it never depends on a localhost 5173 link.
5. The top-right **Play now** link goes directly to `play.html`, bypassing the cinematic journey.

Reversing scroll before the black fade finishes cancels the handoff. The game has its own existing Play button, settings, touch controls, sound controls, scoreboard, leaderboard and membership form. Its logo returns to the main experience without nesting another landing page inside the game.

No additional animation frames have been generated. The original landing video, ball model, game model, textures, reflection maps, physics data and sounds retain their original bytes. Phone/tablet framing and existing game device controls are preserved.

## Push to GitHub

The journey video is 248,630,827 bytes, about 237 MiB. GitHub's ordinary Git limit is 100 MiB; `.gitattributes` configures this file for Git LFS. Keep the hidden `.gitattributes` and `.gitignore` files. Use Git rather than the GitHub browser upload form.

For a new, empty repository:

```sh
cd "$HOME/Desktop/SOFACET-Website"
git init -b main
git lfs install --local
git add .
git lfs ls-files
git commit -m "Add SOFACET landing and pinball game"
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the example remote with your real repository URL. The LFS list must include `assets/journey-through-clip6.mp4`. If this folder is already a Git repository, use its existing branch and remote instead of initializing again.

## Hosting

This combined version needs **Node.js hosting**, because verified scores, player sessions and membership use server API routes. GitHub stores the project; GitHub Pages does not run this backend and does not support the LFS journey video.

- Project root: this folder.
- Install: `npm ci`.
- Build: `npm run build`.
- Start: `npm start`.
- Configure the host to materialize Git LFS files before publishing, for example `git lfs pull` if it does not do so automatically.
- Set `HOST=0.0.0.0` on the hosting service. The service may assign `PORT` itself.
- Set `APP_ORIGIN` to the exact public HTTPS origin, with no trailing slash, to preserve same-origin checks and secure player cookies.
- Set `DATA_DIR` to a private persistent disk directory. This preserves players and scores across restarts. The existing file store supports one server process; multiple replicas need shared storage first.
- Confirm the host supports serving the 237 MiB video. The included server streams MP4 byte ranges without loading the entire video into memory. LFS solves Git storage, not a provider's file-size restriction.

The package includes compiled browser files and editable game source. Static-only hosting can show the front end, but it will not provide working score verification, membership and leaderboard APIs; deploy the Node server for the combined experience.

## Railway deployments

Production runs in the existing **so-facet / facet-pinball / production** service at https://shopsofacet.com. The existing `/data` volume stores players and scores; keep the service at one replica.

The `Railway CI/CD` GitHub Actions workflow runs on pull requests and pushes to `main`. It checks out Git LFS assets, installs Node.js 26 dependencies, checks TypeScript, builds the game, and smoke-tests the server, game session API, public assets, and video byte ranges. Successful pushes to `main` then deploy to the existing Railway service, wait for that deployment to become healthy, and check the public website. You can also run the workflow manually on `main` from GitHub Actions.

The repository's `RAILWAY_TOKEN` Actions secret must contain a Railway token scoped to this project's production environment. Rotate it in Railway and update that GitHub secret when needed. No token belongs in source control. The target project, environment, and service IDs are recorded in `.github/workflows/railway.yml`; `railway.json` records the build, start, health-check, and restart settings. GitHub Actions owns automatic deployment, so a second native Railway GitHub autodeploy is unnecessary.

The deploy job uploads the video's small Git LFS pointer to stay below Railway's upload-size limit. During the build, `scripts/materialize-video.mjs` downloads the video from this public repository and verifies its committed size and SHA-256 before publishing it. A normal local build or CI check with LFS already checked out uses the existing video. If this repository becomes private, provide an authenticated asset download before deploying.

Railway variables include `HOST=0.0.0.0`, `PORT=8080`, `APP_ORIGIN=https://shopsofacet.com`, `DATA_DIR=/data`, and `RAILPACK_NODE_VERSION=26`. Rewards credentials remain in Railway. `/health` is a read-only readiness endpoint that does not create player records.

To run the same local checks:

```sh
npm ci
npm run build
npm run smoke
```

`npm run smoke -- https://shopsofacet.com` checks the live site's readiness, landing and game assets, video streaming, and private-file protection without creating game sessions. The local smoke test uses temporary player storage that is removed afterward.

## Environment and membership

`.env.example` contains empty placeholders, not credentials. Real `.env` files are ignored by Git. Put production values in your hosting service's environment settings.

- `REWARDS_API_KEY`: needed for the existing membership/rewards integration.
- `REWARDS_API_BASE`: existing SO FACET backend URL, supplied in the example.
- `REWARDS_ADMIN_SECRET`: required only for the protected internal reward-award endpoint.
- `LEADERBOARD_MODE`: `game` by default; the original `rewards` option also needs rewards credentials.

No existing keys, player records, membership details or cookies are included. The game is playable and local verified scores work without rewards credentials; membership registration reports that it is not configured until you supply them. The privacy page is still the existing coming-soon placeholder. Replace it with the owner's completed policy before collecting memberships publicly.

## Files to push

- Landing HTML/CSS/JavaScript and linked About/Privacy pages.
- `play.html` and compiled game code in `assets/`.
- Required models, textures, lighting maps, collision data, audio and artwork.
- `game-source/`: game HTML, TypeScript, CSS and TypeScript configuration for rebuilding.
- `server.mjs`, `rewards.mjs`, `verify-game.mjs`, `replay-worker.mjs`: the existing game APIs plus the combined static-file server.
- `package.json`, `package-lock.json`, `scripts/build-game.mjs`.
- `vendor/`, `licenses/` and `sounds/SOURCES.md`: bundled runtime dependencies and license/source notices.
- `.gitignore`, `.gitattributes`, `.env.example`, this README.

The Desktop delivery excludes password/access-gate pages, Blender `.blend` files, the unused old registration page, private player data, `.env` secrets, `node_modules`, source Git history, backups, logs, screenshots and test reports. The used membership form remains because it is part of the referenced game; it is not a password gate.

## Verification

Local browser checks cover the final-frame fade and game handoff, reversing during the fade, direct Play now navigation, game Play/settings, a verified game-session start, replay-worker validation, phone layout, MP4 byte ranges and blocked private-file routes. The game source and runtime assets were copied from the current port-5173 project. Existing animation/video files remain unchanged.

Physical phone/iPad testing, final audio balance and the live membership integration with real credentials are separate from the automated deployment checks.

Official GitHub references: [large-file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [Git LFS setup](https://docs.github.com/en/repositories/working-with-files/managing-large-files/configuring-git-large-file-storage), [LFS and GitHub Pages](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage).
