# Independent static hosting on Cloudflare Pages

Status: static hosting prepared and production browser checks passed. Cloudflare account access is required to connect GitHub and publish. No DNS records or Cloudflare services are provisioned by the build.

Cloudflare serves `frontend/dist` independently of the Omarchy VM. Shutting down the VM does not prevent the hosted HTML, JavaScript, CSS or navigation from loading. Live data still requires an available read-only indexer; static hosting does not run BCHN or the indexer. There are no Pages Functions or Workers in this setup.

## Build and public API configuration

Only the frontend package is required:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
```

The build produces `frontend/dist`. Relative assets and hash navigation work on static hosting without application routing rules. Node is pinned in `frontend/.node-version`.

`VITE_API_BASE_URL` is public, build-time configuration. The app appends `/vaults` to the base (which can include a prefix). Changing it requires rebuilding and redeploying. See `frontend/.env.example`.

| Configuration | Behavior |
| --- | --- |
| Unset in `npm run dev` | Existing `/api/vaults` Vite proxy to loopback port 3100 |
| Unset in a production build | Offline viewer; no API requests |
| `VITE_API_BASE_URL=https://indexer.example.com` | GET `https://indexer.example.com/vaults` |
| `VITE_API_BASE_URL=https://example.com/read-only` | GET `https://example.com/read-only/vaults` |
| `VITE_API_BASE_URL=/api` | Explicit same-origin API; requires a separately configured reverse proxy in production |

For the existing local built preview with its existing loopback proxy:

```bash
VITE_API_BASE_URL=/api npm --prefix frontend run build
npm --prefix frontend run preview
```

Development launcher commands, QEMU forwarding and the proxy allowlist are unchanged. A frontend environment override can be put in `frontend/.env.local` (ignored by Git). Remove it to restore the automatic development default.

## Offline and snapshot behavior

- A new visitor with no reachable/configured API sees the full site shell, navigation, offline explanation and retry controls when configured. No balances or fabricated vaults are shown. Demo data is not shipped.
- A successful, schema-valid, confirmed-only regtest response with a tip and fresh connected indexer health is saved in browser local storage. Storage is scoped to the API endpoint and version. Disconnected, malformed, missing-tip or stale responses do not replace that saved snapshot. Failed or blocked browser storage does not prevent rendering.
- A saved snapshot is available only in that browser, on that website origin, for that endpoint. It is not a repository snapshot or data shared with new visitors. Changing domains/endpoints or clearing site storage removes access to it. No snapshot from the VM is bundled into the site.
- After reload, cached data is always marked **Last-known confirmed snapshot · not current**, including while a reconnection request is pending. Fetch time, original indexer synchronization time, block height/hash and chain MTP remain visible. Snapshot times never advance on failed refreshes. Confirmation metadata comes from the read-only indexer; it is not independent browser verification and may have been superseded by a reorg.
- In-session request failures, indexer disconnection and synchronization timestamps older than 30 seconds also produce historical/stale labels. Allocation eligibility becomes “Recheck synchronization.” Rankings, balances and other values are interpreted at the displayed snapshot, never as current data.
- Configured APIs retry every ten seconds after a request completes, with a ten-second timeout. Manual refresh, tab visibility and browser reconnection also retry. A fresh response replaces the projection and removes stale warnings. No transactions, signing or wallet operations are added.

This guarantees a hosted page can render with the VM off; it does not make a visitor's browser load the site without internet access. There is no service worker or offline asset installation.

## Required Cloudflare and GitHub configuration (perform when ready to publish)

1. Review and commit these changes with the existing local development changes you intend to retain, then push them to the existing repository: `https://github.com/scinklja/bch-staking`. The inspected local branch is `feature/frontend`; select the branch containing the reviewed deployment changes rather than assuming `main` already has them.
2. Sign in to the intended Cloudflare account. Under **Workers & Pages**, create a **Pages** project using **Connect to Git / Import an existing Git repository**, and connect GitHub. Authorize the Cloudflare GitHub application for `scinklja/bch-staking` (selected-repository access is sufficient). An organization repository may require an organization owner to approve the application. [Git integration guide](https://developers.cloudflare.com/pages/get-started/git-integration/) and [GitHub permissions](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).
3. Select that repository, an available project name such as `staking-arena`, and the production branch containing the reviewed changes. Set:

   | Setting | Value |
   | --- | --- |
   | Framework preset | React (Vite) |
   | Root directory | `frontend` |
   | Build command | `npm run build` |
   | Build output directory | `dist` (relative to `frontend`) |
   | Node version | `24.22.2` via `.node-version`; optionally also set `NODE_VERSION=24.22.2` |
   | `VITE_API_BASE_URL` | Leave unset for independent offline hosting; set an independent HTTPS indexer URL only if one exists |

   Cloudflare installs the frontend dependencies using its lockfile. No root contract compilation or regtest startup is required. [Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [build image / Node selection](https://developers.cloudflare.com/pages/configuration/build-image/).
4. Configure environment variables separately for **Production** and **Preview** if enabling API data. All `VITE_*` values are shipped to visitors. No Cloudflare API token, GitHub token, RPC credentials, seed, cookie or sponsor key belongs in the bundle. Git integration needs no deployment token committed to the repository.
5. **Stop before “Save and Deploy” until publication is intended.** The first build creates a hosted deployment. Preview deployments also publish URLs. After project creation, review **Settings → Builds & deployments → Branch control** to limit or disable automatic production/preview builds as desired. [Branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).
6. When ready, deploy and verify the assigned `https://<project>.pages.dev` address. A custom domain is optional; configure it through Pages custom domains with the required DNS ownership/records. No DNS change is required for the supplied Pages address. Shut down the VM for the final operational check: pages must still render, show offline/snapshot labels when appropriate, and make no request to a local RPC service.

The Cloudflare dashboard controls the Git-connected build; no Wrangler configuration or deployment command is required. No account configuration above has been performed yet.

## Optional independent read-only API

The deployed site can remain offline-only indefinitely. To supply live data while the VM is off, an indexer must be available independently of that VM. Configuring or relocating that service is outside this change. Do not point the public build at `localhost`, a VM-only address, an RPC port, or a tunnel to BCHN.

An independent endpoint must serve the existing confirmed-only v0.3.0 regtest JSON over HTTPS and allow browser CORS GET requests from the production Pages origin and any intentionally enabled preview/custom-domain origins. A public endpoint with no credentials may use `Access-Control-Allow-Origin: *`; origin allowlists should return `Vary: Origin`. This frontend sends no cookies or authentication credentials. CORS must be supplied by that API, not by static Pages headers. HTML responses, CORS errors, timeouts and incompatible chain/schema responses are handled as outages. This change does not enable mainnet or real funds.

## Verification without any backend

```bash
npm --prefix frontend test
npm --prefix frontend run test:browser
npm --prefix frontend run test:static
```

`test:static` builds two production variants (default offline and a configured HTTPS API), then serves only built files using a plain Node file server on loopback port 4174. It has no proxy, no API routes and starts no indexer or BCHN. Browser tests verify offline rendering/navigation/reload, the configured URL and GET requests, failed API handling, saved snapshot reload and recovery. Reachable responses in that test are explicitly synthetic test fixtures intercepted by Playwright; they are never included in the production bundle. Existing browser tests continue to use the local Vite development setup on port 5173.

For a lighter verification after `test:static` has produced both builds, run `npm --prefix frontend run test:static:dom`. It executes the actual compiled React application in jsdom, with network requests disabled, and checks rendering, navigation, the offline default and configured-API outage handling. This complements browser tests; it does not verify browser layout, asset loading or real cross-origin CORS.

For this small VM, a real-browser check without extra test workers or tracing is available after both production variants have been built: `CHROMIUM_PATH=/path/to/chrome-headless-shell NODE_OPTIONS=--max-old-space-size=128 npm --prefix frontend run test:static:browser`. Install a suitable browser with `npm --prefix frontend exec -- playwright install chromium --only-shell`. See [recorded verification](static-hosting-verification.md).
