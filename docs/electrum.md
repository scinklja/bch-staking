# Electrum indexer and read-only API

The read-only reader also runs in a browser worker over WSS with IndexedDB; see [browser Electrum](browser-electrum.md). Node remains an optional API and regression backend.

Run the existing service on chipnet without a BCHN node, RPC credentials, spending keys, a keeper, or a cloud account:

```sh
npm ci
ARENA_PROVIDER=electrum ARENA_NETWORK=chipnet npm run arena -- config/electrum-chipnet.json
curl http://127.0.0.1:3100/health
curl http://127.0.0.1:3100/vaults
```

The example pins a real chipnet vault already recorded in this workspace. Replace `vaults` with explicitly admitted genesis IDs and immutable parameters for other vaults, or use `[]` to check connectivity without indexing a vault. Discovery of arbitrary new vaults is not implemented. Use a **separate checkpoint** from BCHN: Electrum checkpoints use version 2, BCHN version 1. A checkpoint has one service writer, enforced by the existing process lock. The service creates the checkpoint directory.

Configuration:

- `ARENA_PROVIDER=electrum` explicitly selects Electrum. Omitting it preserves BCHN and regtest behavior.
- `ARENA_NETWORK=chipnet` is required. The adapter recognizes mainnet as a configuration type but rejects it at construction. Regtest remains BCHN only.
- `ARENA_ELECTRUM_ENDPOINTS=ssl://chipnet.bch.ninja:50002,ssl://chipnet.imaginary.cash:50002` supplies ordered failover servers. These are also the defaults. Each endpoint must specify a port; `tcp://` is available for explicitly configured servers and local protocol tests. TLS validates certificates.
- `ARENA_ELECTRUM_TIMEOUT_MS=10000` bounds each connection and protocol request. Failed connections are closed. The entire snapshot retries on the next endpoint; sessions never switch servers halfway through a snapshot. Polling reconnects after failure. Concurrent API/indexer sessions are serialized.
- Service JSON retains `vaults`, `checkpoint`, `port`, `pollMs`, and `keeper`. Set `keeper:false`; Electrum mode rejects keeper activation or a sponsor key before starting the service.

All broadcasts are deliberately disabled in this adapter, including chipnet. The `NetworkProvider.sendRawTransaction` method exists for interface compatibility and rejects. Wallet write endpoints return the existing read-only 405 response in Electrum mode. No Chaingraph integration, browser settlement, mainnet, website change, or deployment is included.

## Existing BCHN dependency audit

| Existing component | RPC operations and replacement |
| --- | --- |
| `indexer.sync` | `getblockchaininfo`, `getblockhash`, `getblockheader`, `getblock`, `getrawtransaction`; replaced by script histories, transaction proofs, raw bytes and headers. No block-body scan remains in Electrum mode. |
| `indexer.verifyUtxos` | `gettxout`; Electrum checks decoded outpoints, token-inclusive UTXOs and confirmed/pending spends from histories. |
| `verifyRegistryGenesis` | Network assertion and `getrawtransaction` for genesis/factory parent; receives a proof-backed Electrum reader and provider instead. |
| `BchnProvider` / `TokenBchnProvider` | `getblockcount`, `getrawtransaction`, `scantxoutset`, `getrawmempool`, `gettxout`, `sendrawtransaction`; retained for BCHN/regtest. Electrum implements the same CashScript provider interface with raw, token-aware reads and disabled sends. |
| Read-only API transaction status | `getrawtransaction` and ready-network assertion; Electrum uses raw transaction, output-script history, proofs and linked headers. |
| Network assertion used by these components | `getblockchaininfo`, `getblockhash` (genesis and chipnet fork), plus readiness `getnetworkinfo` and `getconnectioncount`; Electrum uses protocol negotiation, header pins and tip freshness. |
| `arena.ts` | Contract construction/record decoding/ranking itself makes no RPC call; provider injection avoids BCHN reads when contracts are used by Electrum. |
| Existing wallet write routes | Node-backed plans, `gettxout`, `testmempoolaccept`, `sendrawtransaction`, and signing/broadcast readiness; disabled in Electrum mode. No node-backed wallet functionality is added to the read-only commit. |
| Keeper | Remains on BCHN with its existing transaction construction, policy checks, UTXO checks and broadcasting. Not migrated or changed. |

## Architecture and verification

`src/electrum.ts` implements CashScript's `NetworkProvider` interface using libauth's transaction decoder. CashScript 0.14's `ElectrumNetworkProvider` was examined: it provides raw transactions and CashToken UTXOs, but not the histories, proofs, header ranges, or pinned failover snapshots required by this indexer. A bounded persistent JSON-lines socket transport exposes those documented methods without adding a dependency. Contract instances can receive either provider; the existing keeper's provider and implementation remain unchanged.

Exact satoshi integers and CashToken fungible amounts come from transaction bytes. Satoshis are stored as decimal strings in decoded outputs; `satoshis()` and `utxo()` use these exact values. The historical `value` BCH number is retained for response compatibility, but never used for Electrum accounting. Token categories, capabilities, and NFT commitments retain libauth's display byte order. UTXO responses supply outpoints; their amounts are checked against decoded raw outputs and their transactions' proofs. Unsafe JSON integer values are rejected. Token amounts from verbose server JSON are not trusted.

Each sync:

1. Negotiates Electrum Cash protocol 1.5 or later (requests 1.5.0), checks genesis and the chipnet-specific height-121957 fork checkpoint, and rejects a stale/inconsistent tip (older than six hours or more than two hours in the future).
2. Finds the configured confirmed genesis through its output script history and verifies its transaction hash and Merkle inclusion. Retrieves and verifies the authorized factory parent, scripts, immutable parameters, initial state commitment, and reserve using the existing genesis verifier.
3. Queries the registry and pool locking scripts, fetching confirmed raw transactions and Merkle proofs. Does not infer registration order from history order, transaction-ID order, or Merkle position. Orders same-block dependencies topologically and projects only the canonical outpoint-0/outpoint-1 lineage through the existing state verifier.
4. Derives immutable allocation scripts from verified transition witnesses and queries those histories to discover independent allocation spends. Reprojects the complete confirmed state, retaining exact ranking rules and frozen activation records.
5. Rejects conflicting confirmed spends, incomplete canonical lineage, mismatching UTXOs, changed histories, changed proof headers, and changed tips. Links all relevant proof headers through every intervening block to the indexed tip. Computes MTP from eleven linked headers. A missing UTXO is allowed only when a separately reported unconfirmed transaction actually spends it; that pending spend never changes confirmed state.
6. Atomically writes and fsyncs the candidate checkpoint, then publishes it in memory. On any failure, retains the last successful snapshot and marks health disconnected/stale. Restart reads the checkpoint but publishes no reconstructed vaults until fresh reconciliation succeeds. Every pass reconstructs from fresh data, so both shorter-chain rollbacks and replacement branches at the same height recover without trusting an old checkpoint.

This conservative full replay trades efficiency for straightforward recovery. It does not yet use subscriptions to incrementally maintain histories or cache proofs across passes. Deep histories can be expensive and can exceed a server's limits; truncation/errors or inconsistent responses cause synchronization failure. The response size bound is 16 MiB.

## Protocol operations

The implementation uses the [Electrum Cash/Fulcrum protocol specification](https://electrum-cash-protocol.readthedocs.io/en/latest/protocol-methods.html), rather than Bitcoin Electrum token assumptions:

| Requirement | Electrum Cash method |
| --- | --- |
| Protocol version | `server.version` |
| Indexed provider tip | `blockchain.headers.subscribe` (initial response; polled each sync) |
| Header, fork pin, MTP | `blockchain.block.header` |
| Link inactive gaps to tip | `blockchain.block.headers` (up to 2016 per batch) |
| Raw CashToken transaction | `blockchain.transaction.get(txid, false)` |
| Inclusion, height | `blockchain.transaction.get_merkle` |
| Registry/pool/allocation history | `blockchain.scripthash.get_history` |
| Token-inclusive UTXOs | `blockchain.scripthash.listunspent(scripthash, "include_tokens")` |
| Connectivity diagnostic coinbase discovery | `blockchain.transaction.id_from_pos` (diagnostic script only) |

Protocol 1.5 adds explicit token-inclusive UTXO filtering. A compatible token-aware server is required; the adapter does not silently retry a token-blind protocol. Scripts are hashed as reversed SHA-256 of **locking bytecode without token prefixes**. Protocol errors, unsupported methods, pruned transaction data, malformed responses, and unknown transaction status fail closed.

## API compatibility and trust boundary

All existing GET vault endpoints and response fields remain available. `/health` adds provider name, endpoint, connected/error status, synchronization status, stale flag, last successful update, and separate unconfirmed transaction IDs. The existing tip contains height/hash/MTP and `confirmedOnly:true`. Health becomes 503 on failure or after 60 seconds without a successful update; stale vault data remains labeled in response metadata. `/transactions/:txid` uses script history and inclusion proofs in Electrum mode. Unknown/unprovable lookup returns 503 `unavailable`: a missing history entry cannot reliably distinguish dropped, orphaned, unavailable, and never-seen transactions.

**Electrum is not a full validating node or a complete-history proof system.** Merkle inclusion and linked headers prove inclusion relative to the server's selected header chain. This implementation pins network identity and verifies header linkage but does not validate proof of work, difficulty transitions, cumulative work against competing peers, or execute all blockchain consensus rules. History completeness and unspent status remain server assertions: Electrum has no cryptographic non-spend proof and cannot prove a server omitted no transaction. A consistently dishonest server can conceal a suffix of history and its spends; checking UTXOs, proofs and repeated reads detects contradictions, not all omissions. Public failover improves availability, not consensus or Byzantine quorum security. These are essential protocol limitations, not assurances of BCHN-equivalent trust. Missing or contradictory evidence is rejected; no contract/economic checks have been removed. Use a trusted token-aware server or retain BCHN for full local consensus validation.

There is no global vault enumeration, server-independent mempool view, guaranteed historical transaction retention, or reliable orphan/dropped classification. Unconfirmed transactions are observational only. An absent or unconfirmed configured genesis withholds the new snapshot; it is never admitted optimistically.

The Node implementation is an HTTP service with TCP/TLS and filesystem persistence. A shared browser implementation is now available as documented above. It needs a running process wherever the frontend obtains its API, but can run on a local computer and does not require Railway, a VPS, or deployment. The browser reader uses WSS and IndexedDB with the same portable protocol/replay/view logic; only the Node TCP transport and process/file persistence remain platform-specific. Browser keeper settlement is outside this phase.

## Verification

```sh
npm run typecheck
npx tsx --test tests/electrum.test.ts
npx tsx scripts/electrum-check.ts
# Capture a real configured vault, never broadcast:
ARENA_NETWORK=chipnet npx tsx scripts/electrum-capture.ts config/electrum-chipnet.json /tmp/electrum-capture.json
# Existing BCHN regression tests remain available:
npm run node:start
npm test
```

`tests/fixtures/electrum-chipnet.json` contains public raw transactions, proofs, headers, histories and expected state captured from the configured real chipnet vault. Offline protocol tests replay these actual responses, including a confirmed independent withdrawal. Reorganization and fault cases deliberately modify those responses; replacement headers are synthetic fixtures, never claimed as a real public reorganization. Tests cover exact 64-bit token amounts, restart reconciliation, history order, allocations/withdrawals, same-height replacement and shorter-chain rollback, pending separation, stale tips, proof/header corruption, connectivity loss, real local socket timeouts/reconnect/failover, API endpoints and write rejection.

See `docs/electrum-verification.json` and `docs/electrum-daemon-verification.json` for live verification results and [the test report](electrum-test-results.md) for execution outcomes. Live connectivity and actual vault indexing are separate from deterministic fault/reorganization simulations.
