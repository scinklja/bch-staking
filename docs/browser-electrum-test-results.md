# Browser Electrum execution report — 2026-11-11

Implementation branch: `dev/browser-electrum-indexer`. The initial checkout already contained unrelated frontend, wallet, service and deployment edits; those were preserved. No remote repository was pushed and no website was deployed.

## Implemented

The React static build can use chipnet WSS directly, with no application API or BCHN. The original Electrum protocol, canonical lineage/state replay, exact amounts, ranking and view code are shared between Node and the browser. The new browser-specific pieces are native WSS transport, an asynchronous worker-ready handshake, IndexedDB atomic checkpoints, Web Locks/BroadcastChannel coordination, configuration, source selection and clear provider/cache/error status. The existing Node TCP/TLS adapter, HTTP API, BCHN scanner and regtest paths remain operational. Browser mode disables wallet actions; it does not implement settlement or broadcasting.

## Final executed results

| Command/check | Result |
| --- | --- |
| `npm test` | **19 passed, 0 failed**: 16 BCHN/regtest/Electrum-fixture tests plus 3 separately bootstrapped chipnet VM/network tests. Includes the full allocation, keeper daemon, keeper/indexer recovery, legacy vault/registry, standard-policy, API/CORS and local node regressions. No failed-test rerun was required for this full execution. |
| `npx tsx --test tests/electrum.test.ts` after adding storage/bound checks | **5 passed**. Existing groups additionally check atomic checkpoint failure and history/transaction/raw-byte limits. |
| `npm run typecheck` | Passed after the extraction and final safety/cleanup changes. |
| `npm --prefix frontend test` | **30 passed across 9 files**, including the new source/configuration/worker-handshake/lifecycle tests. |
| `npm --prefix frontend run test:browser` | **5 passed**, preserving existing API-mode navigation, mobile forms, stale snapshots and wallet dialog behavior. |
| `npm --prefix frontend run test:static` | **2 passed**, with explicitly offline and configured-API production builds. |
| `npm --prefix frontend run test:static:browser` | Passed: production static routes, mobile layout, exact ranking/offer calculation, persistent cache and recovery, GET-only behavior, no browser JavaScript errors. |
| `npm --prefix frontend run test:electrum` | **6 passed**, running a real module worker, native WSS and IndexedDB. Tests cover confirmed vault/withdrawal replay, reload/stale cache, failover, multiple tabs and takeover, a synthetic replacement branch, bad proofs, configured history bounds, and IndexedDB write failure retaining committed state. |
| `npm run test:dev` | All **8 lifecycle checks passed**: stale PID records, concurrent/cold startup, preserving manually started processes, recovery after indexer/Vite/BCHN interruption, port collision, graceful stop, and unchanged saved configuration/checkpoint/chain. The saved regtest reader checkpoint was reconciled before running this opt-in test; the pre-test cache was backed up and restored afterward. No blocks were mined by this lifecycle test. |
| Production frontend build / frontend typecheck | Passed. Relative ES-module worker assets load under the GitHub Pages project prefix. No Node socket, filesystem or RPC shims are used in the worker. |
| Real browser public chipnet verification | Passed with BCHN and the Node API **actually stopped**, not merely hidden behind missing RPC credentials. Both node RPC ports (18443, 48332) and API port 3100 were closed; no `bitcoind` or Arena API process was running. Details below. |
| Node fallback after extraction | Live `scripts/electrum-verify.ts` passed against the real chipnet vault, including UTXOs, restart and all read-only API routes. The RPC endpoint was unavailable and no transaction was sent; see `docs/browser-electrum-node-fallback.json`. |
| Covenant integrity | Compiler-generated timestamp changes were checked to contain no other artifact differences, then restored. `contracts/` and `artifacts/` have no task changes. Keeper implementation and staking economics were not changed. |

The original intermittent/regression failures were addressed at their causes:

- Chipnet VM tests previously imported their shared provider while the suite still selected regtest, then changed the environment inside the test. `scripts/test-regressions.mjs` now launches the chipnet group with its network selected **before module evaluation**. The regtest and chipnet groups run separately and serially.
- Relay RPC readiness can precede P2P listener readiness, and an isolated peer's first block download can exceed 60 seconds on this VM. The loopback fixture retries dialing if there is no peer, allows up to 180 seconds for initial sync, and reports the observed peer tip on failure. Transaction relay assertions and covenant checks remain intact. The allocation and policy tests passed in the full run.
- Browser testing reproduced an initial worker-message race caused by libauth's top-level asynchronous WASM initialization. The worker now announces readiness after its message handler exists; React sends configuration only after that handshake. A bounded startup timeout reports failure. Deterministic worker tests and live reload/tab tests pass with this change.

## Real public browser evidence

`docs/browser-electrum-verification.json` records the actual production build served as plain static files under `/staking-arena-site/`:

- Provider: `wss://chipnet.bch.ninja:50004`; both public default WSS endpoints also accepted protocol handshakes during investigation (`chipnet.bch.ninja` and `chipnet.imaginary.cash`, port 50004).
- Indexed tip: **331884** for the recorded run.
- Configured real vault: genesis `128606824ed744a0f7f5ba45904bd87180cd0483df79b4fb54da125fcf75be74`, category `a79f2bd4b33f7583ead1a750cfbc86f54dc2b2855bd8b2eea5e9342f11690fa5`.
- Confirmed independent withdrawal displayed; wallet actions disabled.
- First sync: **11,680 ms** on this VM, including static application/worker/WASM loading and network reads. This is a single observation, not a service-level guarantee.
- IndexedDB: one configuration-scoped checkpoint; reload succeeded.
- Simulated browser network disconnection produced an explicit stale/error state; reconnect/manual refresh recovered.
- A second real browser tab followed the leader; closing the leader triggered takeover and fresh synchronization.
- **0 API/RPC requests**, **0 page JavaScript errors**, **0 broadcasts**, **no deployment**. The recorded HTTP requests are only local static assets; chain reads use WSS.

Reorganizations, provider faults and proof corruption in deterministic tests are deliberately simulated with captured public transaction bytes/proofs and synthetic headers. They are not claims of observing an actual public reorganization. Test-only TLS certificate bypass applies only to the local fixture browser configuration; public production connections use normal TLS validation.

Local chipnet services were stopped with their existing managed launcher, and regression-owned regtest/verification services were also shut down. They remain stopped after verification. The Node fallback verification used a temporary in-process server and closed it.

## Files and architecture

New portable source: `src/bytes.ts`, `src/amount.ts`, `src/arena-core.ts`, `src/genesis-core.ts`, `src/electrum-core.ts`, `src/indexer-core.ts`, `src/view.ts`.

Platform adapters/storage: `src/electrum-tcp.ts`, `src/electrum-wss.ts`, `src/indexeddb.ts`; existing Node entries `src/electrum.ts`, `src/indexer.ts`, `src/arena.ts`, `src/genesis.ts` and `src/api.ts` delegate to the common implementation. `src/registry.ts` uses portable byte/hash helpers without changing its arithmetic.

Frontend integration: `frontend/src/arena.worker.ts`, `frontend/src/browserConfig.ts`, `frontend/src/useArena.ts`, `frontend/src/model.ts`, `frontend/src/App.tsx`, Vite ES-module worker configuration, public environment example and test/build scripts. Root `buffer` dependency is explicitly pinned. `ws` and its types are frontend **test-only** dependencies.

Verification: `tests/fixtures/electrum-replay.ts` shares the existing public fixture simulator, `tests/electrum.test.ts` adds portable storage/limit assertions, `frontend/tests/browserIndexer.test.tsx`, `frontend/tests/electrum/worker.spec.ts`, `frontend/playwright.electrum.config.ts`, and `frontend/scripts/verify-electrum-browser.mjs`. Existing static serving supports a separate fixture build. The test runner and loopback relay fixture contain the regression fixes described above.

Documentation and manual workflow preparation: `README.md`, `docs/electrum.md`, `docs/browser-electrum.md`, this report, live evidence JSON, frontend CI (root+frontend install and WSS regression), and the manual-only Pages workflow (Electrum/API choice without a mandatory API for Electrum). No workflow was dispatched and no push/publishing step was performed.

## Limits and remaining hosting requirement

The browser path needs only static asset hosting and reachable public WSS infrastructure. **No application backend hosting is required for read-only indexing.** Optional API mode still needs a separately running Node service. This does not make public Electrum infrastructure unnecessary.

Replay remains conservative and complete on every pass; it is not an incremental/paginated history indexer. The worker is approximately **542 kB uncompressed**, and the application/wallet bundle approximately **846 kB / 326 kB gzip**. The build reports a chunk-size warning. Large histories use worker CPU, network, IndexedDB quota and multiple times the raw byte size in decoded objects. Defaults cap responses at 16 MiB, histories/UTXO rows at 50,000, transactions at 20,000 and aggregate raw transaction bytes at 16 MiB. Exceeding bounds or storage quota withholds the candidate, preserves stale data and reports an error; it never truncates a supposedly verified state.

Genesis discovery remains explicitly configured. Persistence can be evicted or denied by the browser, and public servers can be unavailable, prune data, rate-limit or omit history. Web Locks/BroadcastChannel sharing requires supported secure-context browser APIs; independent-tab fallback behavior is documented. Browser execution coverage is Chromium; Safari and Firefox were not run.

Electrum cannot prove complete history or non-spending. This implementation checks hashes, inclusion, linked headers and covenant-state reconstruction against a server-selected chain, but does not independently validate proof of work, difficulty transitions or competing-chain cumulative work. Server trust remains necessary; failover is not a cryptographic quorum. See [configuration and trust details](browser-electrum.md). No covenants, economics, mainnet transactions or browser settlement were added or changed.
