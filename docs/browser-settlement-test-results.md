# Browser settlement implementation and verification

Verified on 2026-11-11 on `dev/browser-electrum-indexer`. No deployment, push, covenant source change, or covenant bytecode change. Existing browser-indexer/test prerequisites were first preserved in commit `5cb8d6e`; settlement changes are committed separately.

## Implementation and files

- `src/keeper-core.ts`: portable existing keeper transaction construction, exact reserve arithmetic, signature-free transitions and mandatory local BCH 2026 covenant VM validation.
- `src/keeper.ts`: Node/BCHN wrapper delegates construction, retaining sponsorship and node mempool/broadcast checks.
- `src/electrum-core.ts`: explicitly opt-in chipnet broadcasting, chain-identity/session guard, pinned sessions, returned transaction-ID verification. Read-only Node services retain the default broadcast prohibition.
- `src/indexer-core.ts`: publish normalized observed histories only after successful verified replay/persistence, for settlement reconciliation.
- `src/browser-keeper.ts`: fresh confirmed replay, canonical winner proposal checked by covenant VM, dual-provider current-input/history/tip/MTP checks, pending/conflict handling, durable intent, sequential transitions, reorg recovery and bounded retry backoff.
- `src/settlement-store.ts`: IndexedDB write-ahead intent storage, containing public transaction bytes and metadata only.
- `frontend/src/arena.worker.ts`: integrate the shared keeper, per-vault Web Locks, cross-tab controls/status, versioned reader leadership, disabled-by-default automation and manual requests.
- `frontend/src/useArena.ts`, `model.ts`, `App.tsx`, `SettlementStatus.tsx`: runtime preference, worker messages/models, manual action and visible lifecycle/fee/status information. No wallet approval flow.
- `tests/browser-keeper.test.ts`, `tests/fixtures/settlement-chain.ts`, `tests/fixtures/settlement-chipnet.json`: captured real genesis/registration bytes plus deterministic confirmations, races, adversarial transitions, outages and reorganizations.
- `tests/arena.test.ts`: retain independent BCHN invalid-preimage rejection even though the shared builder now rejects malformed state earlier.
- `frontend/tests/SettlementStatus.test.tsx`, `browserIndexer.test.tsx`, `electrum/settlement.spec.ts`: UI preference/control and real-worker native-WSS lifecycle regressions.
- `frontend/scripts/build-settlement-fixture.mjs`, `verify-browser-settlement.mjs`, `static-server.mjs`, `frontend/package.json`: isolated static fixtures and real public chipnet browser verification.
- `scripts/chipnet-prepare-browser-settlement.ts`: optional explicit, guarded Node-only test-wallet setup; not a browser/runtime dependency.
- `config/browser-settlement-chipnet.json`: public immutable parameters of the completed live case; existing default vault configuration is unchanged.
- `docs/browser-settlement.md`, this report and `browser-settlement-chipnet-verification.json`: operation, architecture, fees, limitations and durable public-chain evidence. README and the browser/Node Electrum guides link the new functionality.

## Executed tests

| Command/check | Result |
| --- | --- |
| `npm test` | **25 passed**: 22 serialized regtest/protocol/keeper tests, then 3 chipnet/local-VM/network-safety tests; 0 failed/skipped. Includes compile and root TypeScript checks. |
| `npm --prefix frontend test` | **32 passed**, 10 files. |
| `npm --prefix frontend run test:electrum` | **11 passed**: 6 existing reader/worker tests plus 5 settlement tests, using native WSS, real workers and IndexedDB. Repeated clean runs passed. |
| `npm --prefix frontend run test:browser` | **5 passed**: existing frontend browser regressions. |
| `npm --prefix frontend run test:static` | **2 passed**: production offline/configured static routes. |
| `npm --prefix frontend run test:static:dom` | Offline and configured DOM/asset checks passed. |
| `npm --prefix frontend run test:static:browser` | Production navigation, ranking/calculation, mobile layout, cache/poll recovery, GET-only API compatibility and no page errors passed. |
| Root/frontend TypeScript; production builds | Passed. Build retains Vite's large-chunk advisory; it is not suppressed. |
| Public chipnet browser verification | **Completed both periods** with four confirmed covenant transitions; no API/RPC requests or page errors. |

The long full regression run took approximately 15.6 minutes for its regtest group on this VM. Native browser tests use synthetic block confirmations after the captured real setup; they do not establish real mining or public-server availability. The public-chain run is recorded separately below.

Coverage includes eligibility by chain MTP; immutable activation; canonical tied winner; immediate reward; independent allocation/maturity; confirmed-only sequential periods; manual action with automation off; independent browser races; reload/tab takeover; missing broadcast acknowledgement; provider outage/disagreement; malformed/stale journal; failed journal persistence; rejected mempool submissions; relay rotation using identical saved bytes; fee-policy/sponsorship blockers; competing confirmed spends; and reorganized confirmations. Wrong tied winners, changed reward outputs, non-final transactions, reserve breaches and mainnet attempts are rejected.

## Failures resolved and previous intermittent tests

The first full run encountered the existing Node test's `/sponsorship required/` assertion after the shared fee error message changed. The typed error now retains that phrase and adds the browser explanation. The complete rerun passed all 25 tests. This did not change fee arithmetic or on-chain validation.

The previous malformed-preimage test constructed invalid bytes through the keeper builder. Mandatory local validation now correctly refuses that construction earlier. Its regression now asserts the early refusal and separately mutates a valid raw transaction for BCHN `testmempoolaccept`; the independent node rejection assertion is preserved.

Earlier frontend intermittency had two documented causes: VM memory/renderer starvation and cached-response test synchronization. The existing prerequisite changes retain diagnostic collection, bounded browser concurrency, DOM-ready navigation, explicit recovery/poll synchronization, and the worker-ready handshake after WASM initialization. See [browser test reliability](browser-test-reliability.md). No sleeps, automatic success retries, or weakened state verification were added to hide a failure. All frontend suites listed above passed in this phase; this does not guarantee browsers cannot be suspended or the environment cannot run out of memory.

## Real chipnet evidence

Public WSS servers: `wss://chipnet.bch.ninja:50004` and `wss://chipnet.imaginary.cash:50004`. The recorded run used two independent browser storage contexts concurrently and closed/relaunched a browser with its durable intent. Chipnet BCHN and Node API were stopped before processing. A separate isolated regtest node was started later for regression testing; it was never the browser's provider.

| Period | Transition | Confirmed txid | Height |
| --- | --- | --- | --- |
| 0 | Activation | `66786908b7479f611dee4215bef7adeb79e5e8f81c6ccfdccc08738554b983aa` | 331891 |
| 0 | Winner settlement | `bc30818e04837416a2e8dbdeb4374b3cc7c529179c933f70b35509b0d6b8cad3` | 331892 |
| 1 | Activation | `34974f5d227f30ade043e13a41d1aa8e770a6b11539e11c06569a30e6be71fc1` | 331893 |
| 1 | Winner settlement | `1a7243f9e078c08696b7217fc68bce30354e7f0ffcc292647f330b1c0b323d51` | 331895 |

Both settlements selected canonical slot 0 from equal-priority offers and paid its owner 1,000 satoshis each. Each created its own 2,000-token allocation with the scheduled maturity. NFT BCH reconciled from 60,000 to 14,000: 40,000 miner fees, 2,000 rewards and 4,000 allocation carriers. The pool retained its 1,000-satoshi carrier. See [machine-readable live report](browser-settlement-chipnet-verification.json).

## Fees, performance and remaining backend needs

No new fee mechanism was introduced. Each unsponsored transition spends exactly 10,000 satoshis of existing vault excess BCH. A winning settlement additionally spends its reward and the existing 2,000-satoshi allocation carrier. The committed remaining reward reserve plus 1,000 satoshis is checked before sending and by the covenant VM. Insufficient excess or relay fee rejection blocks processing and explicitly requires an external BCH sponsor. The browser does not sign, request sponsorship signatures or contain keys; the Node sponsor callback remains available.

The default worker polls every 15 seconds. Full replay, source proofs, and three pre-send provider-check sessions add latency and repeat work; large histories remain bounded by existing transaction/history/byte limits and fail closed at those limits. Current production assets include an approximately 728 kB minified worker and 855 kB main application chunk (about 328 kB gzip for the latter). These are not a throughput benchmark. Only Chromium was exercised.

No dedicated application backend is needed while a supported browser is open and the configured providers agree. Web Locks, BroadcastChannel and IndexedDB are required for browser settlement. Always-on progress when browsers close or suspend, or external fee sponsorship, may still benefit from an independent/Node keeper. Electrum service is still an external infrastructure dependency. Server agreement cannot cryptographically prove complete history or non-spending; header linking is not full PoW/difficulty/cumulative-work verification. Broadcast acceptance is never confirmation. See [testing instructions and trust limits](browser-settlement.md).
