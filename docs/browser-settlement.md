# Browser automatic settlement — chipnet only

A static Staking Arena frontend can now activate and settle configured chipnet vaults without a Node API, BCHN, hosted keeper, WizardConnect signature, spending key, or wallet approval. It reuses the existing keeper's transaction layout and covenant rules. Nothing has been deployed or published; covenant source and bytecode are unchanged.

## Running it

Install root and frontend dependencies, build, then serve the static site:

```sh
npm ci
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend run preview
```

The default production source is chipnet Electrum when no API URL is configured. For Vite development without a Node API, use:

```sh
VITE_INDEXER_MODE=electrum npm --prefix frontend run dev
```

Open a vault's details page. **Enable automatic settlement on chipnet** is initially off, persists in localStorage, and applies to all listed chipnet vaults on that origin. Enable it once to process eligible periods while the website stays open. **Process Period** requests one transition for the selected vault even when automation is off. Activation and settlement remain separate confirmed transactions. Disabling automation stops future submissions; it cannot recall a transaction already sent. Wallet creation/offer/withdrawal actions remain separate existing workflows and are not automatically signed.

The shipped default vault is already complete. To inspect the completed two-period case verified in this phase:

```sh
VITE_ARENA_VAULTS="$(cat config/browser-settlement-chipnet.json)" npm --prefix frontend run build
npm --prefix frontend run preview
```

To process a different existing vault, set `VITE_ARENA_VAULTS` to its genesis and immutable parameters, as documented in [browser indexing](browser-electrum.md). Genesis must be confirmed and pass the existing factory authorization checks. There is no new global vault discovery or registration mechanism.

The default WSS endpoints are `wss://chipnet.bch.ninja:50004` and `wss://chipnet.imaginary.cash:50004`. Settlement requires two different configured hostnames that agree on the exact indexed tip, MTP, current canonical input confirmation, histories and unspent outputs. A single endpoint remains usable for reading, but cannot authorize browser settlement. The selected relay must also support the documented [Electrum Cash transaction broadcast method](https://electrum-cash-protocol.readthedocs.io/en/latest/protocol-methods.html#blockchain-transaction-broadcast).

No mainnet mode or mainnet broadcasting is enabled. Node/API mode and the existing BCHN/regtest keeper remain available; the new browser setting does not start a Node keeper.

## Shared construction and validation

`src/keeper-core.ts` is the reusable builder. `src/keeper.ts` retains the existing Node RPC readiness, sponsorship callback, mempool policy test, and broadcast path while delegating construction to this core. The browser worker uses the same core through `src/browser-keeper.ts`.

For each vault, the core uses verified state to propose action 2 (activate), 3 (pay one eligible winner), or 5 (advance an empty activated period). It computes exact priority cross-products `S × T / R` and resolves exact ties by canonical registration slot, using the immutable activated roster. It does not create an independent authority for choosing winners: the compiled Registry covenant checks that proposed winner against every eligible frozen record. A negative test constructs a later tied winner with otherwise consistent outputs; local VM verification rejects it.

The transaction preserves the existing structure:

- Inputs 0 and 1 spend the current state NFT and its paired token pool, in that order.
- Outputs 0 and 1 recreate the state NFT and pool with the exact next-state commitment and remaining escrow.
- A winning settlement additionally pays the winner's BCH reward immediately at output 2 and creates the existing independent `StakeAllocation` at output 3.
- Allocation owner, vault/category binding, period, stake and scheduled maturity are unchanged. Late processing still uses the scheduled boundary, rather than restarting a relative lock from the settlement date.
- Permissionless actions supply an empty authorization argument. They require no owner signature; the pool spend also requires none. No wallet provider or private key is passed to the browser keeper.

Every browser candidate is checked by libauth's BCH 2026 VM against the exact decoded source outputs. That validates covenant scripts, frozen preimages, priorities/ties, reward destination/amount, token conservation, allocation terms and the committed reserve. A malformed indexed preimage is rejected before construction. The SDK retains standard transaction-size, implicit-burn and fee-rate checks. The local VM is version-pinned; it does not replace node policy checks, chain consensus validation, or eventual confirmation.

Finality is checked separately. The candidate is version 2 with non-final, BIP68-disabled sequences. Activation uses its scheduled timestamp as locktime, only when verified chain MTP is strictly greater than that boundary. Settlement/empty advancement retains the existing `MTP - 1` locktime. Height and timestamp locktime thresholds are checked; browser wall-clock time never determines period eligibility. Wall time is used only for retry scheduling and freshness.

## Fee funding

The existing covenant fixes the unsponsored value changes. No fee mechanism or covenant change was added.

| Action | Reduction in vault NFT BCH | Additional outputs | Miner fee |
| --- | --- | --- | --- |
| Activate | 10,000 satoshis | None | 10,000 satoshis |
| Settle one winner | Reward `R` + 12,000 satoshis | `R` to winner; 2,000-satoshi allocation carrier | 10,000 satoshis |
| Advance empty activated period | 10,000 satoshis | None | 10,000 satoshis |

The pool's 1,000-satoshi carrier is preserved. Staking tokens are never sold, burned or used to pay BCH fees. Each candidate must leave:

```text
NFT output BCH >= remainingPeriods × rewardCap + 1,000 satoshis
```

This is the existing on-chain reserve invariant, independently checked by the builder and VM. The browser checks the exact 10,000-satoshi miner fee before broadcasting. Unsponsored settlement therefore works only when the vault already has enough excess BCH for that transition. Sufficient reward reserves do not imply sufficient fee funding for all future transitions, cancellations or refunds.

If the next transition would invade the reward reserve, the UI shows **Blocked: safe fee funding unavailable** and explicitly reports that an external BCH fee sponsor is required. If a server rejects the fixed fee under its relay policy, that requirement is also reported. The browser never raises the fee by weakening the reserve or asks for a wallet signature. The existing extra BCH sponsor input is still supported by the Node builder/callback, but no automatic browser sponsor/key mechanism was introduced. Even a valid fixed-fee transaction may fail a server's current relay policy; acceptance and mining cannot be guaranteed.

## Submission, confirmation and coordination

Each processing pass starts with the existing full confirmed-state Electrum synchronization. Saved checkpoints and UI views cannot authorize a spend. The keeper then:

1. Acquires a per-category Web Lock shared across configurations on that origin.
2. Reads the durable journal and reconciles its transaction against confirmed canonical history. Previously confirmed intents removed by a reorg become uncertain; a competing confirmed descendant supersedes the old intent.
3. Checks for real unconfirmed transactions spending either canonical outpoint. Our own or a competitor's pending spend causes waiting, not optimistic application or child construction.
4. Builds and VM-validates a candidate. Two distinct configured endpoints must independently match the fresh indexed tip/MTP, source confirmation/block hash, normalized script histories and exact token-aware canonical UTXOs. Headers link each source proof to that tip.
5. Commits a write-ahead intent containing raw bytes, transaction ID, parent outpoint, action/slot/period and retry deadline to IndexedDB **before** any submission. Failure to persist means no send.
6. Opens one pinned, chipnet-identity-checked relay session, rechecks current data, verifies processing is still enabled/requested, and sends `blockchain.transaction.broadcast`. The returned ID must equal the locally computed ID.
7. Reports **Pending confirmation** after acceptance. Only a later confirmed replay including that ID on the canonical registry lineage reports **Confirmed**. The next transition starts after confirmed synchronization, with a visible confirmation step between actions.

No write is automatically retried on another server within the same session. An error or disconnect after sending can mean acceptance is unknown, so the intent becomes uncertain. A later independent retry first re-synchronizes and repeats all checks, then reuses exactly the saved raw transaction and ID. Backoff starts at 30 seconds and caps at 15 minutes. Relay endpoints alternate across reconciled retries, rather than replaying a possibly accepted write during failover. Read polling also backs off after outages.

This does not promise globally exactly-once network submission. Independent users, origins, profiles and Node keepers can race. Same-origin Web Locks reduce local duplication; only BCH validation and spending the unique canonical NFT/pool decide the final chain. Mempool conflicts, dropped transactions and reorganizations are reconciled through fresh histories, proofs and UTXOs. There is no fee replacement, unconfirmed ancestor chaining, or optimistic period cursor.

Reader leadership and BroadcastChannel continue to share snapshots across tabs. Settlement controls are relayed to the leader, and the per-category lock/journal also cover separate reader configurations. Closing a leader transfers ownership. Worker termination/browser suspension can occur at any point; a prepared intent covers a crash before acknowledgement or before sending. On resume, fresh synchronization precedes another attempt. Web Locks and BroadcastChannel are required for browser settlement; reading still works with its prior fallbacks. The reader coordination key is versioned to prevent an older read-only tab from blocking a newer settlement-capable worker.

Storage is separate from reader checkpoints: `staking-arena-settlement-v1`, store `intents`, keyed by category. It holds only public raw transactions and metadata, never keys. It retains the latest intent per vault; confirmed on-chain history remains the indexer's source of truth. Invalid journal metadata fails closed. Browser storage can be evicted or denied; mandatory pre-send persistence failures block sending. Loss of the journal cannot prove a transaction was never submitted, so fresh on-chain/mempool reconciliation remains necessary.

## Status and settings

Vault details display waiting for the next period, activation required, settlement required, broadcasting, pending confirmation, confirmed, failed/retrying, blocked fee funding, or completed state. They also show the transaction ID and retry deadline when applicable. Existing index/provider/stale indicators remain visible. Manual processing is disabled while the view is stale, the spend is pending, or all periods are complete. Turning automation off cannot stop independent keepers or recall an already transmitted transaction.

The `arena-chipnet-automatic-settlement` localStorage setting defaults to false. It is a processing preference, not a signing credential. The existing API wallet routes and WizardConnect workflow are unchanged and are not used for period processing.

## Testing

```sh
# Existing contract, Node keeper and protocol regressions:
npm run node:start
npm test
# UI/model/controller tests and native static WSS/worker tests:
npm --prefix frontend test
npm --prefix frontend run test:electrum
npm --prefix frontend run test:browser
npm --prefix frontend run test:static
```

Native WSS tests use captured real chipnet genesis/registration bytes and synthetic subsequent headers/confirmations. They perform actual worker-side building, local VM verification, IndexedDB journaling, Web Locks and WebSocket requests. These fixtures are deliberately separate from real public chain evidence.

For a **new**, funded chipnet test fixture, `scripts/chipnet-prepare-browser-settlement.ts --create` can use a local test wallet holding at least 100,000 BCH satoshis and 6,000 fungible test units. It refuses an existing fixture file. This optional Node-only setup uses wallet keys only in process memory to fund a factory and sign two registrations; no key is persisted in its public configuration or shipped to the frontend. It creates two equal-priority offers with the earlier registration expected to win both periods. It is not part of the browser settlement runtime and should not be rerun against the already completed fixture.

After setup transactions confirm, stop chipnet BCHN and the Node API. The live driver refuses their usual listening ports and starts only static file serving plus Chromium:

```sh
# Requires a newly prepared, confirmed fixture in .chipnet/browser-settlement-fixture.json:
npm --prefix frontend run verify:settlement:live
```

The driver builds against the fixture's public parameters and public WSS endpoints, starts two independent browser contexts concurrently, enables automation, closes/relaunches with saved IndexedDB/localStorage, and waits for both periods to confirm. It verifies canonical tied winners, immediate rewards, allocations, and the exact final reserve. Do not use the deterministic loopback fixture build as live evidence.

## Real chipnet result

The completed public test used genesis `0590c06a8c72ac695bf646f551c7f642490da79f5ff6023b87303082d53a6686` and category `eab65cffbba58cdb1ec2de5981bebfab251f975bce99a5ffe6834fff0898fab4`.

| Period (zero based) | Action | Confirmed transaction | Height |
| --- | --- | --- | --- |
| 0 | Activate | `66786908b7479f611dee4215bef7adeb79e5e8f81c6ccfdccc08738554b983aa` | 331891 |
| 0 | Settle slot 0 | `bc30818e04837416a2e8dbdeb4374b3cc7c529179c933f70b35509b0d6b8cad3` | 331892 |
| 1 | Activate | `34974f5d227f30ade043e13a41d1aa8e770a6b11539e11c06569a30e6be71fc1` | 331893 |
| 1 | Settle slot 0 | `1a7243f9e078c08696b7217fc68bce30354e7f0ffcc292647f330b1c0b323d51` | 331895 |

Both tied offers had priority 2. The earlier canonical registration won both periods, receiving 1,000 BCH satoshis and a separate 2,000-token allocation each time. Allocation maturities matched `epoch + (period + duration) × periodSeconds`. Starting NFT BCH was 60,000 satoshis. Final NFT BCH was 14,000: 40,000 total miner fees + 2,000 rewards + 4,000 allocation carriers were accounted for exactly. Pool BCH stayed at 1,000, and unallocated token escrow remained intact.

Chipnet BCHN and the API were shut down before processing, and the browser made zero API/RPC requests. An isolated regtest node was started later for the separate regression suite; it was not used by the browser. No browser signing key, wallet approval, deployment or public website update was involved. See [live evidence](browser-settlement-chipnet-verification.json) and [the full test/file report](browser-settlement-test-results.md).

## Remaining limits and backend assessment

A dedicated application backend is **not required** for indexing or permissionless activation/settlement while supported browsers are open and sufficient fee funding/public Electrum service is available. Initial vault/offer creation and owner withdrawals remain separate signed workflows. A Node or independent keeper is still useful for reliable progress when all browsers are closed, suspended, offline or throttled, and for external fee sponsorship. This phase does not provide always-on liveness.

The reader still performs full replay with its configured history/transaction/byte bounds. Two-endpoint checks add network latency and trade availability for caution: one unavailable or disagreeing required host can block processing. Browser/IndexedDB limits, storage eviction, relay policy, pending conflicts and mining delays can stall it. The local VM is BCH-2026-specific and is not a generic replacement for future network-rule upgrades or full node validation. Chromium was exercised; Safari/Firefox were not run.

Electrum still cannot cryptographically prove complete history or non-spending. Linked headers and Merkle proofs are relative to a server-selected chain; proof of work, difficulty transitions and competing-chain cumulative work are not validated here. Two agreeing endpoint observations improve contradiction detection, not Byzantine consensus. Missing evidence fails closed; a consistently dishonest pair can still misrepresent chain/history. Broadcast acceptance is never treated as confirmation, and confirmation can still be reorganized. These trust limits have not been weakened or hidden to make settlement work.
