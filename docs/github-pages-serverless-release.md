# Serverless chipnet Pages release

Target: https://scinklja.github.io/staking-arena-site/

Implementation base: `0762f95` on `dev/browser-electrum-indexer`. Follow-up release changes preserve the marketplace layout, add the explicit **CHIPNET — TEST FUNDS ONLY** notice and unavailable wallet-action labels, and fix a worker acknowledgement race in the automation checkbox. No covenant source or bytecode is changed.

## Release configuration

Run `node frontend/scripts/build-pages.mjs` from the private source repository. It typechecks and produces `frontend/.pages-production` with the explicit `/staking-arena-site/` Vite base, `VITE_INDEXER_MODE=electrum`, `VITE_API_BASE_URL=` and chipnet-only public WSS endpoints:

- `wss://chipnet.bch.ninja:50004`
- `wss://chipnet.imaginary.cash:50004`

The release lists the existing reference vault and the completed browser-settlement test vault. Both are already complete; their registrations, remaining offer rankings, allocations and completed processing states are real chain data. Rankings are compared directly with the verified envelope, including any unexhausted losing offer; completion never authorizes a new period. Deterministic worker tests exercise active rankings and processing. No new transaction is needed to verify this release.

Automation defaults off for a fresh origin; an existing user's explicit stored preference remains a user choice. Browser settlement is opt-in, chipnet-only and signature-free. Create Vault and Make an Offer remain preview routes with disabled submit buttons and an explicit browser-mode unavailability explanation. Owner withdrawals also remain unavailable in browser mode.

Only `index.html`, `arena.svg`, compiled hashed assets and `.nojekyll` may enter the public repository. Source maps, source files, fixtures, reports, contracts, backend data, environment files and credentials must stay private. The public repository has its own history and must never receive the source repository's history. Use normal fast-forward publication to its existing `main` branch; do not run the private repository's Pages workflow.

## Saved rollback version

Prior public compiled commit: **`eeb7240aff9188a6806a95c54504ce497be248ff`**. Saved locally in `.pages-release/rollback-commit.txt`, a complete `.pages-release/rollback.bundle`, and public rollback branch [`rollback/pre-serverless-2026-11-11`](https://github.com/scinklja/staking-arena-site/tree/rollback/pre-serverless-2026-11-11). The bundle contains the public artifact repository only.

To restore the old compiled version without rewriting public history, in a separate clone of `scinklja/staking-arena-site`:

```sh
git switch main
git pull --ff-only origin main
git restore --source=eeb7240aff9188a6806a95c54504ce497be248ff --staged --worktree .
git commit -m "Rollback to previous compiled marketplace"
git push origin main
```

Wait for Pages to publish, then inspect the actual URL. Keep the saved commit and bundle until the new release is verified.

## Verification commands

```sh
npm --prefix frontend test
npm --prefix frontend run test:electrum
npm --prefix frontend run test:browser
ARENA_NETWORK=chipnet node --import tsx --test tests/browser-keeper.test.ts
node frontend/scripts/build-pages.mjs
cd frontend
PAGES_REPORT=../docs/github-pages-serverless-local-verification.json node scripts/verify-serverless-pages.mjs http://127.0.0.1:4183/staking-arena-site/ .pages-production
# After publication, repeat against HTTPS without a local directory argument:
PAGES_REPORT=../docs/github-pages-serverless-live-verification.json node scripts/verify-serverless-pages.mjs https://scinklja.github.io/staking-arena-site/
```

The read-only production check opens a fresh browser context, verifies the Pages prefix, real chipnet synchronization, both chain identity pins on both WSS endpoints, actual vault/offer/settlement displays, automation off, disabled completed-vault manual processing, disabled creation/offer submission, IndexedDB checkpoints, disconnection/stale state, reconnection, reload and mobile width. It records requests and page errors. It never clicks a processing control or signs anything.

## Deployment status

Published public compiled commit: **[`4c420d6c7cc555c44c39ef6badc8f4fe73f0a0c3`](https://github.com/scinklja/staking-arena-site/commit/4c420d6c7cc555c44c39ef6badc8f4fe73f0a0c3)**, built from source `fce13cd` (implementation `0762f95` plus release UI fixes). GitHub Pages reported that exact commit as `built` at `2026-11-11T21:37:00Z`. Authenticated settings confirmed the existing legacy Pages source remains `main` at `/`.

All six served website assets match the verified production build by SHA-256; the seventh repository file is the existing empty `.nojekyll`. No source checkout, source maps, environment/configuration files, reports, wallets, backend files or source-repository history were published. See [deployment manifest](github-pages-serverless-deployment.json) and [old served-version evidence](github-pages-serverless-rollback-verification.json).

The GitHub connector lacked write permission, so publication used the existing authenticated Git CLI after the desktop keyring was unlocked. No repository visibility or Pages settings changed.

## Tests and release fixes

- Frontend unit suite: **32 passed** across 10 files.
- Native WSS/worker/IndexedDB suite: **11 passed**, including all 5 settlement cases and the 6 reader/reorganization/storage cases.
- Existing frontend browser suite: **5 passed**.
- Shared keeper protocol/VM suite: **6 passed**; root TypeScript check passed.
- Production build/typecheck and prefix-specific live WSS check passed without BCHN or Node API. [Local production evidence](github-pages-serverless-local-verification.json) includes both public provider identities, vault/offer/ranking displays, IndexedDB, offline/reconnection, reload, mobile layout and automation off.
- The implementation's earlier complete **25-test** Node/BCHN/regtest/chipnet suite remains documented in [settlement results](browser-settlement-test-results.md). This deployment phase reran the relevant suites above; it did not mutate covenant artifacts.

Pre-release native tests exposed two UI races. A worker snapshot queued before an automation toggle could revert its checkbox; the hook now preserves the requested preference until its acknowledgement. A background refresh could disable Process Period during a click; a fresh displayed vault can now queue the request while syncing, with the worker still requiring fresh replay and all UTXO/VM checks before sending. A deterministic test pauses a background response and verifies queued manual processing. The paused fixture uses the production 10-second timeout. No state validation, fee reserve check, or covenant rule was weakened.

The production reconnection check waits for the existing online-event/poll recovery rather than clicking a refresh button that is correctly disabled during its current replay. No processing control is clicked during deployment verification.

## HTTPS verification

The actual HTTPS site passed the complete read-only browser check on 2026-11-11: [public verification evidence](github-pages-serverless-live-verification.json). First synchronization took **23,131 ms**, indexing chipnet height **331937**. Both public WSS endpoints negotiated protocol 1.5 and matched the chipnet genesis/fork pins.

The reference vault displayed one registration, no remaining ranked offer and one allocation; the settlement test vault displayed two registrations, one remaining ranked losing offer and two independent allocations. Both displayed **All periods processed**. Ranked table order matched the verified indexer envelope. The manual processing control appeared and was correctly disabled for completed vaults; the automatic control was enabled but unchecked, remaining off after reload. Creation and offer submission buttons were disabled with explicit unavailability labels.

IndexedDB persistence, provider disconnect/stale display, online reconnection, fresh replay after reload and mobile width passed. There were **zero API/RPC requests, zero JavaScript errors and zero HTTP error responses**. All recorded HTTP requests were GETs under the Pages project prefix. No processing control was clicked, no wallet was connected and no new real transaction was submitted. Manual/automatic transaction construction and submission were exercised separately by deterministic worker tests; the earlier real chipnet settlement evidence remains in the implementation report.

## Runtime limits

First synchronization of the two-vault production build took about 23 seconds in the local production check. Full replays, WebAssembly startup and public-server latency vary; periodic replay can temporarily reach the UI's conservative stale-data threshold. Large histories still hit explicit safety caps rather than publishing partial state. Only Chromium was exercised.

The static site needs no dedicated BCHN, Node API or hosted keeper. Processing needs an open, supported browser, two agreeing public providers, available IndexedDB/Web Locks/BroadcastChannel and safe excess BCH fees. Closed/suspended browsers provide no always-on liveness. Electrum completeness/non-spending and chain-selection trust limitations remain as documented in [browser settlement](browser-settlement.md). No new real transactions were created for deployment checks.
