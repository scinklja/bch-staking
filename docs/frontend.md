# Staking Arena read-only web frontend

Branch: `feature/frontend`, based on `feature/keeper-indexer`. React + TypeScript with Vite produces a static frontend in `frontend/dist/`. No contract, keeper or indexer behavior changes are required. There is no wallet integration, transaction signing, deposit, refund or withdrawal submission. Nothing is published or merged automatically.

## Start locally

From the repository root, with the pinned Node version:

```bash
mise exec -- npm ci
mise exec -- npm --prefix frontend ci
mise exec -- npm run node:start
mise exec -- npm run frontend
```

Open **http://127.0.0.1:5173**. The startup command runs the existing indexer in read-only mode on `127.0.0.1:3100` and the Vite server on `127.0.0.1:5173`. Ctrl+C shuts down both owned processes. It does not stop BCHN.

On first use, the startup helper creates `.regtest/frontend/config.json` using the canonical vault configuration in the saved keeper integration evidence. This is an actual confirmed vault on this machine's preserved regtest chain, not simulated frontend data. Its schedule may already be complete. No new vault, tokens, transactions or blocks are created by frontend startup. The private checkpoint is separate from keeper checkpoints. The helper does not overwrite an existing configuration.

On another chain or checkout without that genesis, explicitly configure admitted vaults with their real genesis and immutable parameters as described in [the indexer guide](keeper-indexer.md). Set `keeper: false`, `port: 3100`, and a new checkpoint path. Then run:

```bash
mise exec -- npm run frontend -- /absolute/path/index-only-config.json
```

If the indexer already runs on port 3100, start only the UI with `mise exec -- npm run frontend:dev`. A conflicting process on port 3100 or 5173 must be resolved by the operator; startup does not terminate unrelated processes. Never share an indexer checkpoint between independent processes. All local servers bind loopback.

## API and refresh behavior

In local development the browser performs GET `/api/vaults`. Production builds use the public `VITE_API_BASE_URL` base, or show offline mode when it is unset. See [Cloudflare Pages and offline snapshots](cloudflare-pages.md). Vite strips `/api` and proxies that request to the existing documented GET `/vaults` endpoint. The response already contains all vault status, offers, rankings, periods, history, allocations and withdrawal projections, together with one indexed chain tip. This avoids mixing projections from different polling instants. No new backend routes exist.

Vite's development and preview proxy only match `/health`, `/vaults`, and the documented vault detail subroutes beneath `/api`. BCHN RPC port 18443 is never a proxy target. Browser source imports no backend code, RPC client, cookie, filesystem accessor or signing key. The startup helper removes `ARENA_SPONSOR_KEY` from the two child environments; no key is necessary for viewing. Vite serves only its frontend root with strict filesystem access. Do not put credentials in frontend source or `VITE_*` variables.

The app fetches immediately, then every ten seconds after each request finishes. Requests have a ten-second timeout, do not overlap, and are aborted on component unmount. Manual refresh, returning to a visible tab, and a browser online event also request fresh data. New responses replace the entire projection, so disconnected allocations and events disappear after a reorg. There is no optimistic protocol state. Fresh confirmed projections are cached in browser storage as explicitly historical snapshots; see the deployment guide for cache scope and limitations.

A failed request preserves the last successfully parsed response and shows a stale-data warning. The API envelope is validated at runtime; malformed responses, non-regtest responses and unconfirmed-only metadata are rejected. Indexer disconnection, missing tip, a last-success timestamp older than 30 seconds, and material future clock skew also produce warnings. Old block MTP alone is not considered an indexer outage: an isolated regtest chain may intentionally stop mining. The UI reports both last fetch and last indexer synchronization. Stale marketplace views label statuses and period progress as historical. All eligibility refers to the indexed state and is subject to reorgs.

## Vault marketplace

The homepage contains the Staking Arena title, a prominent **Create Vault** preview link and a simple list of confirmed indexed vaults. Each listing shows the maximum native BCH reward per period, reward asset, total periods, period duration and indexed open/upcoming/completed status. No names, balances, vaults or supported reward assets are fabricated.

Routes use hashes compatible with direct navigation and reload on GitHub Pages: `#/`, `#/create`, `#/vault/<category>` and `#/vault/<category>/offer`. No server path rewrites are required. Unknown routes and missing indexed vaults have explicit empty states.

Vault details show immutable terms, the staking CashToken category (raw units; no invented symbol/decimals), one-based display of the current period, staking conditions and competing offers. Exact integer cross-products determine ranking; ties use canonical registration slots. Activated periods use the frozen snapshot, including offers cancelled only in the live roster. Inactive live registrations and chain identifiers remain in expandable sections. The indexed cursor determines completion; a delayed unsettled schedule is not marked completed merely because browser time has advanced.

**Create Vault** and **Make an Offer** are clearly labeled form previews. Publication/submission controls are disabled and no transaction, wallet connection or optimistic vault/offer is created. Offer previews calculate P using R in BCH satoshis and the S × W upfront token commitment. Inputs follow the current registry bounds. Creation previews include the existing staking category, BCH cap, period duration/count and UTC epoch; all terms are immutable after eventual publication. Current contracts support native BCH rewards only. CashToken rewards remain explicitly unsupported future functionality.

All data views preserve the existing validated read-only API and browser-snapshot behavior. Stale vault statuses say “at snapshot”; details replace “Current period” with “Period at snapshot.” Persistent historical banners and original fetch/synchronization timestamps remain visible across navigation and reload until a fresh indexed response arrives.

See [redesign verification](marketplace-redesign.md) for current checks. The explorer screenshots and reports below are historical evidence for the earlier interface.

## Static build and hosting

```bash
mise exec -- npm run frontend:build
mise exec -- npm --prefix frontend run preview
```

The default production build is an independent offline viewer. To use the existing preview proxy for live local data, build with `VITE_API_BASE_URL=/api`. Development mode continues to use that proxy by default. Static assets use relative URLs and hash navigation.

See [GitHub Pages hosting](github-pages.md) for the public compiled-only repository and project base path. The [Cloudflare configuration guide](cloudflare-pages.md) remains available as an alternative.

## Earlier explorer checks and screenshots

```bash
mise exec -- npm run frontend:typecheck
mise exec -- npm run frontend:test
mise exec -- npm run frontend:build
mise exec -- npm run frontend:test:browser
mise exec -- npm test
```

Browser tests use the installed Chromium binary (preferring `/usr/lib/chromium/chromium` to avoid desktop wrapper extensions); override with `CHROMIUM_PATH` if necessary. They run one worker and start a localhost Vite server when one is not already running. Their synthetic API fixtures are test-only and exercise the same `/api/vaults` response contract. The production app has no demonstration-data fallback. Live browser checks and screenshots use the actual local indexer separately. With the API and dev server running, `mise exec -- npm --prefix frontend run screenshots` captures all four views into `docs/screenshots/` and verifies that browser requests use only the read-only proxy and that the dev server refuses access to the BCHN cookie.

Run browser QA and BCHN integration tests separately on this small VM. The complete integration suite stops/restarts BCHN and performs temporary reorgs, and its subprocess-startup timers assume available CPU/memory. Stop the combined frontend process before running that suite. Tests append regtest blocks; they preserve existing data and Git milestones. Generated compiler timestamps and historical backend result files should not be mistaken for frontend behavior changes.

Screenshots from the actual local indexer: [dashboard](screenshots/arena-overview-desktop.png), [marketplace](screenshots/arena-marketplace-desktop.png), [expanded period history](screenshots/arena-periods-desktop.png), and [mobile positions](screenshots/arena-positions-mobile.png). [Live browser evidence](screenshots/live-check.json) and the [built static preview check](screenshots/static-preview-check.json) record the chain tip and absence of browser errors.

Final validation: the complete BCHN integration suite passed **9/9, zero failures or skips**; frontend unit/component tests passed **10/10**, browser tests **6/6**, and the strict TypeScript/static build passed. The earlier readiness-timeout run and the test-harness cleanup correction are retained in the report.

The final [frontend verification report](frontend-verification.json) records actual check outcomes, the complete suite result, live API checks and screenshot paths. Known backend operational limits and postponed independent security review remain as documented in the indexer guide.
