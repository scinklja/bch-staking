> Chipnet migration: [current transaction flows and verification limits](chipnet.md). The historical read-only/regtest instructions below remain reference material.

# Staking Arena read-only web frontend

The header supports **Connect Wallet** through [WizardConnect](https://docs.riftenlabs.com/wizardconnect/react/), using `@wizardconnect/react` 0.2.3. Scan the QR code with a compatible wallet, paste the `wiz:` URI into the wallet, or use **Open wallet** when a URI handler is installed. Approve pairing in the wallet. Clipboard access may require HTTPS or localhost; the URI can also be selected and copied manually. Close the dialog or press Escape to cancel pairing.

In API mode, the header shows the wallet name after the wallet-ready handshake and offers **Disconnect**. Relay credentials, wallet identity and shared public derivation paths are stored in localStorage under `staking-arena-wizardconnect-v1`; a paired session reconnects after reload. Disconnect clears this stored session and closes the relay. A fresh browser visit without a saved pairing opens no wallet relay connection. Wallet relays are independent of the optional read-only indexer API, so API-mode pairing can work while the VM is offline. Browser Electrum mode is read-only and does not mount wallet pairing or write controls.

This integration provides wallet connectivity only. It does not request signatures, broadcast transactions, query wallet balances or validate a wallet's network. The indexed application remains regtest-only, and vault creation and offer submission remain disabled previews. Automated unit coverage uses a simulated relay. [Real-wallet verification](wizardconnect-verification.md) separately records successful Cashonize HD pairing over public relays, public-address derivation, refresh recovery and disconnect behavior, along with regtest incompatibility and pending physical mobile tests.

Branch: `feature/frontend`, based on `feature/keeper-indexer`. React + TypeScript with Vite produces a static frontend in `frontend/dist/`. No contract, keeper or indexer behavior changes are required. Wallet pairing is available; transaction signing, deposit, refund and withdrawal submission are unavailable. Nothing is published or merged automatically.

## Start locally

From the repository root, with the pinned Node version:

```bash
mise exec -- npm ci
mise exec -- npm --prefix frontend ci
FRONTEND_HOST=0.0.0.0 mise exec -- npm run dev
```

Open **http://127.0.0.1:5173** in Omarchy, or the Windows-side localhost port from your existing QEMU forwarding in Windows Chrome. See [restart, shutdown, ownership, logs and lifecycle verification](../README.md#restart-after-vm-boot). `npm run frontend` uses the same launcher.

The launcher uses the existing `.regtest/frontend/config.json` and checkpoint, reuses healthy BCHN/indexer/Vite instances, and creates no vaults or blocks. Missing saved data causes an error. The API binds `127.0.0.1:3100`; BCHN RPC remains loopback-only. Vite defaults to `0.0.0.0:5173` for the existing VM forwarding; set `FRONTEND_HOST=127.0.0.1` for guest-only access. Only the frontend's documented read-only API routes are proxied.

Ctrl+C stops only services started by that invocation. `npm run dev:stop` stops all launcher-managed services and preserves manually started instances. A conflicting process or incompatible binding produces an error and is left untouched. The launcher never replaces a saved configuration from historical test evidence. On a different chain, provision the saved configuration and checkpoint explicitly as described in [the indexer guide](keeper-indexer.md), with `keeper: false` and `port: 3100`, before starting development.

The page shows a loading message before React mounts and an explicit message if JavaScript is disabled. Its bootstrap loads the application through a query-qualified entry URL: the bare `.tsx` entry request failed in Windows Chrome, while the queried URL rendered the same live vault data. A failed startup now shows an expandable error instead of leaving an empty page. If loading fails, check `/api/health` in the same browser to distinguish an API/forwarding issue from a frontend module failure.

## API and refresh behavior

In local development the browser performs GET `/api/vaults`. Production builds use the public `VITE_API_BASE_URL` base when configured; without one they default to [direct browser Electrum](browser-electrum.md) with a worker and IndexedDB. Set `VITE_INDEXER_MODE=off` for an offline preview. See [Cloudflare Pages and offline snapshots](cloudflare-pages.md). Vite strips `/api` and proxies that request to the existing documented GET `/vaults` endpoint. The response already contains all vault status, offers, rankings, periods, history, allocations and withdrawal projections, together with one indexed chain tip. This avoids mixing projections from different polling instants. No new backend routes exist.

Vite's development and preview proxy only match `/health`, `/vaults`, and the documented vault detail subroutes beneath `/api`. BCHN RPC port 18443 is never a proxy target. Browser source imports no backend code, RPC client, cookie, filesystem accessor or signing key. The startup helper removes `ARENA_SPONSOR_KEY` from the two child environments; no key is necessary for viewing. Vite serves only its frontend root with strict filesystem access. Do not put credentials in frontend source or `VITE_*` variables.

In API mode the app fetches immediately, then every ten seconds after each request finishes. Requests have a ten-second timeout, do not overlap, and are aborted on component unmount. Manual refresh, returning to a visible tab, and a browser online event also request fresh data. New responses replace the entire projection, so disconnected allocations and events disappear after a reorg. There is no optimistic protocol state. Fresh confirmed projections are cached in browser storage as explicitly historical snapshots; see the deployment guide for cache scope and limitations.

A failed request preserves the last successfully parsed response and shows a stale-data warning. The API envelope is validated at runtime; malformed responses, chains other than chipnet/regtest, and unconfirmed-only metadata are rejected. Indexer disconnection, missing tip, a last-success timestamp older than 30 seconds, and material future clock skew also produce warnings. Old block MTP alone is not considered an indexer outage: an isolated regtest chain may intentionally stop mining. The UI reports both last fetch and last indexer synchronization. Stale marketplace views label statuses and period progress as historical. All eligibility refers to the indexed state and is subject to reorgs.

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

The default production build is an independent [chipnet Electrum reader](browser-electrum.md) requiring only static hosting and public WSS. Install root and frontend dependencies before building; use `VITE_INDEXER_MODE=off` for an offline viewer. To use the existing preview proxy for live local data, build with `VITE_API_BASE_URL=/api`. Development mode continues to use that proxy by default. Static assets use relative URLs and hash navigation.

See [GitHub Pages hosting](github-pages.md) for the public compiled-only repository and project base path. The [Cloudflare configuration guide](cloudflare-pages.md) remains available as an alternative.

## Earlier explorer checks and screenshots

```bash
mise exec -- npm run frontend:typecheck
mise exec -- npm run frontend:test
mise exec -- npm run frontend:build
mise exec -- npm run frontend:test:browser
mise exec -- npm test
```

Browser tests prefer Playwright’s bundled Chromium headless shell and use one worker with no retries. Install it with `cd frontend && npx playwright install --with-deps chromium --only-shell`; use `CHROMIUM_PATH` only for an explicit alternative. Tests use intercepted API fixtures, and local Vite can be reused. The production app has no demonstration-data fallback. Run frontend checks sequentially on the VM. Optional live screenshots require `ARENA_CAPTURE_SCREENSHOTS=1`; failure screenshots and traces remain enabled. See [browser reliability and diagnostic evidence](browser-test-reliability.md) for the measured memory failures, commands, artifact locations and hosted CI coverage.

Run browser QA and BCHN integration tests separately on this small VM. The complete integration suite stops/restarts BCHN and performs temporary reorgs, and its subprocess-startup timers assume available CPU/memory. Stop the combined frontend process before running that suite. Tests append regtest blocks; they preserve existing data and Git milestones. Generated compiler timestamps and historical backend result files should not be mistaken for frontend behavior changes.

Screenshots from the actual local indexer: [dashboard](screenshots/arena-overview-desktop.png), [marketplace](screenshots/arena-marketplace-desktop.png), [expanded period history](screenshots/arena-periods-desktop.png), and [mobile positions](screenshots/arena-positions-mobile.png). [Live browser evidence](screenshots/live-check.json) and the [built static preview check](screenshots/static-preview-check.json) record the chain tip and absence of browser errors.

Historical frontend validation (see the [current browser Electrum report](browser-electrum-test-results.md) for this phase): the complete BCHN integration suite passed **9/9, zero failures or skips**; frontend unit/component tests passed **10/10**, browser tests **6/6**, and the strict TypeScript/static build passed. The earlier readiness-timeout run and the test-harness cleanup correction are retained in the report.

The final [frontend verification report](frontend-verification.json) records actual check outcomes, the complete suite result, live API checks and screenshot paths. Known backend operational limits and postponed independent security review remain as documented in the indexer guide.
