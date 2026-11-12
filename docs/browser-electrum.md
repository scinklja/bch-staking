# Browser Electrum indexing (chipnet)

The GitHub Pages build can read Staking Arena directly from public chipnet Electrum servers. No Node API, BCHN node, VPS, Railway account, Chaingraph service, spending key or independently hosted keeper is required for browser operation. Mandatory permissionless browser activation/settlement is documented in [browser settlement](browser-settlement.md); it starts automatically after verification, needs no wallet signature, and has no opt-out. It does not continue while the site is closed/suspended or providers are unavailable. See the current release evidence in [mandatory processing](mandatory-settlement.md). The existing Node API and BCHN/regtest paths remain available.

## Build and run locally

From the repository root:

```sh
npm ci
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend run preview
```

Open the preview URL. A production build with no `VITE_API_BASE_URL` defaults to browser Electrum. The worker and its assets use relative URLs; the production build has also been verified locally under `/staking-arena-site/`, matching the GitHub Pages project prefix. A plain static HTTP server works; the preview server's optional API proxy is not used in browser mode.

For Vite development without a Node service:

```sh
VITE_INDEXER_MODE=electrum npm --prefix frontend run dev
```

Development otherwise preserves its existing `/api` default. To use an existing read-only API in a production build instead:

```sh
VITE_INDEXER_MODE=api VITE_API_BASE_URL=https://indexer.example.com npm --prefix frontend run build
```

API selection is explicit or inferred from a configured API URL, rather than silently changing the source/trust model when Electrum disconnects. The Node Electrum service still starts with:

```sh
ARENA_PROVIDER=electrum ARENA_NETWORK=chipnet npm run arena -- config/electrum-chipnet.json
```

The manual-only Pages workflow remains available with an Electrum/API source choice. Current compiled-only releases use `frontend/scripts/build-pages.mjs` and the separate public GitHub Pages artifact repository. API mode in the optional workflow retains its API health check. See the [0-conf release notes](zero-confirmation-visibility.md) for this change’s regtest-only validation and release record.

## Public configuration

All `VITE_*` values are public and fixed at build time. See `frontend/.env.example`. Root and frontend dependencies must both be installed: the portable source in `src/` uses the root CashScript/libauth/Buffer packages. Frontend CI now installs both and runs the deterministic WSS tests.

| Setting | Default / behavior |
| --- | --- |
| `VITE_INDEXER_MODE` | `electrum` in a production build with no API URL; `api` when an API base is configured, including the existing Vite development proxy; `off` explicitly disables network reads for previews. |
| `VITE_MIN_DISPLAY_CONFIRMATIONS` | `0`: show validated mempool vaults and offers as pending. `1` or higher gates display by confirmation depth. This does not change spending or settlement requirements. |
| `VITE_ARENA_NETWORK` | `chipnet`. Any other value is rejected in browser mode. |
| `VITE_ELECTRUM_ENDPOINTS` | `wss://chipnet.bch.ninja:50004,wss://chipnet.imaginary.cash:50004`. One to four credential-free WSS endpoints, with optional path. Plain WS, embedded credentials, query and fragment are rejected. |
| `VITE_ARENA_VAULTS` | JSON array of genesis IDs and immutable parameters; defaults to the real chipnet vault in `config/electrum-chipnet.json`. `[]` checks connectivity with no admitted vaults. Up to 32 distinct genesis configurations. |
| `VITE_ELECTRUM_TIMEOUT_MS` | 10,000 per connection/request, configurable from 100 to 60,000. |
| `VITE_ELECTRUM_POLL_MS` | 15,000 between completed successful passes; bounded exponential retry delay up to 60 seconds after failures. Manual refresh and browser-online/visibility events can retry immediately. |
| `VITE_ELECTRUM_MAX_HISTORY` | 50,000 entries per script history or UTXO response. Maximum configurable value 100,000. |
| `VITE_ELECTRUM_MAX_TRANSACTIONS` | 20,000 raw/replayed transactions per pass. Maximum configurable value 50,000. |
| `VITE_ELECTRUM_MAX_RAW_BYTES` | 16 MiB total raw transaction bytes per session. Configurable up to 64 MiB. |
| `VITE_API_BASE_URL` | Optional independent API URL or existing `/api` path; irrelevant when Electrum mode is explicitly selected. Never put RPC credentials in this value. |

Configuration is validated before starting a connection. Genesis discovery has the same scope as the Node Electrum implementation: it begins from explicitly configured genesis IDs, verifies their factory parents, then discovers canonical descendants and allocation spends through script history. There is no global vault enumeration or browser admission/write endpoint. Deployment configurations require rebuilding; created and imported candidates are also retained in the browser-local catalog and verified before display. The shipped example is an existing completed chipnet vault, not an invented listing.

## One implementation, two environments

The former Node-only code has been separated rather than forked:

- `src/electrum-core.ts` contains the original Electrum Cash negotiation, network/fork pins, transaction decoding, exact amounts, CashToken UTXOs, Merkle proofs, header linkage, MTP, freshness checks and whole-snapshot failover. It accepts a connection factory. `src/electrum.ts` and `src/electrum-tcp.ts` preserve TCP/TLS for Node; `src/electrum-wss.ts` supplies native WSS for browsers. WSS uses JSON frames without TCP newline termination, per the [Electrum Cash protocol framing specification](https://electrum-cash-protocol.readthedocs.io/en/latest/protocol-basics.html).
- `src/indexer-core.ts` contains the existing confirmed replay, canonical parent-outpoint ordering, state preimage/commitment checks, immutable snapshots, allocation derivation and withdrawal detection. Both the Node `Indexer` and the browser worker use it. Its storage interface accepts either durable filesystem checkpoints or IndexedDB. The Node-only block scanner remains in `src/indexer.ts` for BCHN/regtest.
- `src/arena-core.ts`, `src/genesis-core.ts`, `src/registry.ts`, `src/amount.ts` and `src/bytes.ts` provide the same contract instantiation, genesis authorization, state arithmetic, exact ranking and byte handling without filesystem, RPC, or Node crypto imports. Existing artifacts are imported as public JSON; their source and bytecode have not been changed. Node convenience functions retain arbitrary artifact loading and the existing keeper provider.
- `src/view.ts` generates the existing vault response model for both the HTTP API and browser. `src/api.ts` continues exporting `vaultView` for callers and retains its routes. The React schema accepts the existing response plus optional provider/sync metadata; vault fields and rankings are not reimplemented in the new worker/client.

The browser worker performs all chain reads, hashing, script/state reconstruction and persistence. The main thread receives API-shaped envelopes and status messages. An explicit ready/config handshake handles libauth's asynchronous WebAssembly initialization, preventing an initial message from being dropped. Worker startup, connection, request, and response limits have clear errors rather than an indefinite loading screen. The browser worker never imports Node socket/filesystem/RPC modules.

Satoshis and token amounts are decoded from transaction bytes using exact integers. Decimal strings cross storage/UI boundaries. The historical numeric `value` field remains for compatibility but is not used for Electrum accounting. NFT capabilities, commitments and category byte order are preserved.

## Persistence, tabs and recovery

`src/indexeddb.ts` atomically stores a complete version-2 checkpoint and its last verified projection in a single IndexedDB transaction. The database is `staking-arena-electrum-v1`, store `checkpoints`. A versioned key hashes the chipnet vault configuration, endpoints and limits, separating incompatible configurations. An IndexedDB write must complete before a new candidate becomes current. Quota, blocked database and write failures retain the previous committed state and display an error.

On reload, a saved projection can be displayed immediately as **historical and not current**. Saved transactions/state are never accepted as the basis of a new replay: the core reconciles fresh public data, inclusion proofs, linked headers and UTXOs before publishing a successful state. Malformed or incompatible checkpoints are rebuilt; unavailable persistence is reported. Browser storage may be cleared/evicted by the browser, especially in private browsing. This loses the cache, not the ability to reconstruct configured vaults.

In secure contexts with Web Locks, one worker per configuration owns the indexing lock. Other tabs use BroadcastChannel to receive envelopes/status and request refreshes. Closing the owner automatically releases the lock; another tab takes over and revalidates. Closing a tab terminates its worker, timers and sockets. All followers apply normal stale-time rules even if a leader stops making progress. Without Web Locks, tabs use independent readers and session-specific storage keys, with atomic writes; duplicated tabs may share their inherited session key, but every newly displayed current state still requires a fresh replay. Cross-tab sharing requires BroadcastChannel; without it followers wait for ownership and retain explicitly stale cache data.

Confirmed spending/settlement state and marketplace display state stay separate. With the default display threshold of zero, raw mempool transactions and dependencies are VM-validated and reconciled across two configured hosts before pending vaults or offers appear. Confirmation requirements for spending are unchanged. Each primary read snapshot stays on one endpoint, and failover reconstructs incomplete attempts. Confirmed Merkle proofs, header linkage and reorganization handling remain in force. Pending entries are rebuilt from current reports after reload, dropped on failed validation, and never persisted as confirmed. See [configurable 0-conf visibility](zero-confirmation-visibility.md) for the local regtest tests and limitations.

The UI reports phase, transaction count, indexed height, endpoint, follower status, last successful update, stale cache, provider and storage errors. Browser mode labels wallet actions unavailable; existing creation/offer forms are previews. Wallet connection/write/status integration remains in API mode. Owner wallet signing remains separate. Permissionless period activation/settlement now uses the same verified reader in this worker; see [settlement controls, fees and safeguards](browser-settlement.md).

## Trust and performance limits

**This is not full node consensus validation.** Network/fork pins, transaction hashes, Merkle branches, linked headers, MTP and covenant-state checks detect malformed or contradictory data. As in the existing Node Electrum adapter, it does not validate proof of work, difficulty transitions or cumulative work against competing servers. The server selects the header chain and asserts complete history and unspent status. Electrum cannot cryptographically prove no history was omitted or no spend exists. A consistently dishonest server can conceal transactions and their spends. Repeated reads, UTXO cross-checks and failover do not create a non-spend proof or Byzantine quorum. Use infrastructure you trust for that role; retain BCHN for full local consensus validation.

Public WSS availability, server history/pruning limits, rate limits, DNS/TLS, browser networking policies and IndexedDB quota can prevent synchronization. Unknown/dropped/orphaned status cannot always be distinguished. The browser reports this and retains stale state, rather than fabricating a current view or silently falling back to a hosted service.

Reconstruction is deliberately a full replay each pass. Raw bytes are cached only within a pinned session; live histories, proofs and headers are rechecked. Dependency ordering is iterative to avoid stack overflow with long transaction chains. Work stays off the UI thread, but CPU, network, memory and storage still grow with relevant histories and the height gap from genesis. Responses are limited to 16 MiB, with configurable history, transaction and total raw-byte bounds. **No data is silently truncated.** Exceeding a limit withholds the new snapshot and requires a deliberate configuration adjustment or another server/API path. Decoded objects and checkpoints can use several times the raw transaction size. Incremental history subscriptions, persistent proof/header caches and pagination are not implemented.

Actual browser execution was verified in Chromium headless shell. Safari and Firefox were not executed; module workers, WebAssembly, WSS and IndexedDB are required.

The reviewed production worker is approximately 542 kB uncompressed; the existing application/wallet bundle is approximately 846 kB (326 kB gzip). Initial WebAssembly/module loading and public network latency contribute to startup time. Vite reports its existing chunk-size warning; these sizes are not a guarantee of runtime memory use. See the live verification JSON for measured first-sync latency on this machine.

## Verification

```sh
npm test                                      # BCHN/regtest + separately bootstrapped chipnet VM tests
npm --prefix frontend test                    # React/model/config/worker lifecycle unit tests
npm --prefix frontend run test:browser        # Existing API-mode browser regressions
npm --prefix frontend run test:static         # Explicit off/API static build regressions
npm --prefix frontend run test:static:browser # Extra static routing/mobile/snapshot checks
npm --prefix frontend run test:electrum       # Native local TLS WSS + real worker and IndexedDB
```

The deterministic WSS tests run a loopback TLS server with captured public chipnet transactions/proofs and synthetic replacement headers. Their test browser trusts only that local fixture certificate through the test configuration; production WSS retains normal certificate validation. They cover restart, stale cache, failover, multi-tab takeover, reorg/withdrawal reconstruction, bad proof rejection, configured history limits and atomic-storage failure. They are distinct from live public connectivity tests.

For actual public chipnet verification, first stop the local BCHN nodes and Node API. The script refuses to run if their usual ports are listening:

```sh
npm --prefix frontend run verify:electrum:live
```

It serves the production build as static files under the GitHub project prefix, checks public WSS indexing and a confirmed withdrawal, IndexedDB reload, provider disconnection/recovery, multi-tab sharing/takeover, worker loading, and absence of API/RPC requests. It writes `docs/browser-electrum-verification.json`. No remote page is modified and no transaction is sent. See [the execution report](browser-electrum-test-results.md) for results and remaining limitations.
