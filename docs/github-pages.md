# GitHub Pages hosting

The public hosting repository is [scinklja/staking-arena-site](https://github.com/scinklja/staking-arena-site). It contains only the compiled website and a `.nojekyll` marker. The source repository `scinklja/bch-staking` remains private, and its `v0.2.0-regtest` milestone is unchanged.

The existing live URL is <https://scinklja.github.io/staking-arena-site/>. GitHub Pages serves the `main` branch root of the public hosting repository. GitHub hosts the static assets independently of the Omarchy VM. No Cloudflare account, API, RPC, keeper, Pages Function or custom DNS record is used.

## Published payload

The initial publication was built from source commit `f2aa2bcbaa723211e73bb94068c9c03f7f7d90d1` on `feature/frontend`, with `VITE_API_BASE_URL` explicitly empty. A clean Git archive of the committed frontend was built using the existing frontend dependency installation. The public repository has its own history; no source-repository history was copied.

The payload consists of `index.html`, `arena.svg`, the hashed JavaScript and CSS under `assets/`, and `.nojekyll`. No source maps, frontend source files, contracts, backend scripts, node/indexer data, wallet files, credentials, real chain snapshots or private documentation are published.

The first static website commit is `a8ee8f8`. Assets use relative paths and hash navigation, so they work below `/staking-arena-site/`.

## Offline behavior

The published build makes no API requests. New visitors see the full interface, navigation and an explicit offline state. It does not display invented balances. Serving the website does not depend on this VM staying online.

An empty API configuration cannot produce new indexed snapshots. If a future build connects an independently hosted HTTPS read-only API, the existing browser-local confirmed snapshot behavior remains available. Cached responses always retain historical/not-current labels after restoration until fresh indexed data is received. Browser snapshots are scoped to the website origin and API endpoint; they are not shared from the VM or with other visitors.

## Updating the public website

1. Review and commit the desired frontend changes in the private source repository.
2. Build only the committed frontend, with the intended public API configuration. For an offline build, set `VITE_API_BASE_URL=` explicitly when building.
3. Clone the public hosting repository into a separate temporary directory. Replace its website payload with the new `frontend/dist` output, retaining `.nojekyll`; remove obsolete hashed assets. Inspect the complete staged file list before committing. Never copy the source repository or its `.git` directory into the public repository.
4. Commit the compiled assets and push `main` normally. Do not force-push or modify milestone tags. GitHub Pages rebuilds and publishes the static branch.
5. Wait for the Pages build to complete, then verify the reported live URL, browser asset loading, navigation/reload and offline labels. If adding an external API later, verify its HTTPS/CORS behavior and outage/snapshot labeling as well.

Useful read-only status commands:

```bash
gh api repos/scinklja/staking-arena-site/pages
gh api repos/scinklja/staking-arena-site/pages/builds/latest
```

The original private repository could not enable Pages: GitHub returned HTTP 422 because the current account plan does not support Pages for that private repository. The separately authorized public artifact repository avoids changing source visibility or requiring an account upgrade. See [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Live verification

GitHub Pages reported `built` for public commit `a8ee8f824e4877f02f885f2c881685ca91462e47`. The actual HTTPS site returned HTTP 200 in Chrome Headless Shell. All navigation views and hash-based reload passed. The offline banner stayed visible; all ten recorded browser requests went to `scinklja.github.io`, with no backend/API requests, failed responses or JavaScript errors. A local screenshot is at `frontend/test-results/github-pages-live.png` (ignored by Git).

The private source branch remains `f2aa2bcbaa723211e73bb94068c9c03f7f7d90d1`, and the original milestone tag remains `3070fb9684a9c51920307bc2bd63b393de819dcd`. Existing uncommitted local-development changes were preserved.

## Marketplace release

The marketplace source is maintained on the private `feature/frontend` branch. Its GitHub Pages production build explicitly uses `VITE_API_BASE_URL=` and `vite build --base=/staking-arena-site/`, preserving local Vite configuration and the existing public URL. Publication copies only the output of that reviewed source build to the public repository. Source, test fixtures, documentation, backend data and source history stay out of the public payload.

Project-prefix browser verification is reproducible with `node scripts/verify-pages.mjs <URL> [build-directory]` from `frontend`. For a local check use `http://127.0.0.1:4175/staking-arena-site/` and the compiled directory; for the deployed check use the existing HTTPS URL without a build directory. Set `CHROMIUM_PATH` to the installed headless browser on this VM. The check exercises HTML/JS/CSS loading, creation previews, unavailable-vault direct links, hash-route reloads, mobile layout and absence of backend calls. It does not invent a vault or imply live indexer availability.
