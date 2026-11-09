# Staking Arena v0.3.0 keeper, indexer and read-only API

Development branch: `feature/keeper-indexer`. The `v0.2.0-regtest` tag, contracts and compiler artifacts remain unchanged. Independent adversarial review is postponed. This implementation runs only against the existing isolated BCHN regtest node. No mainnet support, real-fund operation, or frontend is included.

## Data flow and trust

`BCHN blocks → dependency ordering → canonical lineage replay → atomic checkpoint → GET API / keeper → BCHN mempool → confirmation → replay`

Configure each accepted vault by its genesis transaction ID and immutable staking category, epoch, period length, horizon and reward cap. These are an explicit admission list, not arbitrary NFTs discovered by address. `verifyRegistryGenesis` checks the active-chain, covenant-authorized genesis and pinned immutable parameters. A missing configured transaction causes synchronization to fail until it is available. A configured genesis absent from the active chain is not exposed as an active vault.

The indexer starts at the earliest confirmed configured genesis. Every block from that point has a retained hash, parent, height and MTP. Relevant decoded transactions retain complete unlocking scripts and outputs. BCH canonical transaction order (CTOR) can place a child before its parent: blocks are first ordered by transaction dependencies. Genesis descendants are then selected and replayed in that order. Rewards and allocation descendants are retained as well. Indexing uses blocks and RPC transaction lookup, without `scantxoutset` or address scanning.

The unique state NFT and paired pool outpoints define the canonical lineage. Registry input witnesses contain the full 1,574-byte state. Replay checks predecessor equality, derives every update with the v0.2.0 rules, verifies the successor state commitment, scripts, escrow amount/category and allocation script terms. BCHN validates consensus execution and owner signatures; the indexer does not implement a second consensus VM. It trusts its isolated local BCHN and the pinned artifacts. It does not validate the fungible asset's economic properties.

The materialized projection includes live registrations and immutable terms, cancellations, activation snapshots, complete period event history, settlements, unused-commitment refunds, independent allocation terms/outpoints and allocation withdrawals. Each event retains the predecessor witness; the latest witness and complete registry/pool outputs suffice to build future covenant transitions. Allocation terms reconstruct each independent withdrawal contract. Owner keys are never required for indexing or keeper actions.

## Reorganizations, persistence and outages

Before each poll, compare the retained tip with the active chain and remove blocks back to their common ancestor. Replay the retained and replacement transactions from genesis. If a reorg removes every retained block, recalculate the starting height from configured genesis transactions. Disconnected settlements, snapshots, allocations and withdrawals therefore disappear together. Repeated polls reconstruct the same projection and cannot duplicate events. An active-tip check before publication rejects a chain change during replay; the next poll retries. A reorg can still occur immediately after that check, so all API data is explicitly tied to a block hash and is subject to reversal.

The checkpoint is a versioned JSON block journal with its exact vault configuration. A temporary file is written, fsynced, renamed atomically, and its directory fsynced before publishing the in-memory projection. Restart reconciles checkpoint block hashes with BCHN and replays the journal before declaring readiness. Truncated or incompatible checkpoints fail explicitly. Recovery can also rebuild into a new path from chain data; do not erase BCHN data. A failed RPC poll preserves the last successful projection, marks health disconnected, and retries on the next interval. `/health` returns 503 until a successful synchronization; data endpoints retain the previous tip and health metadata.

## Keeper rules and concurrency

An open period becomes ready only when chain MTP is strictly greater than its fixed UTC activation boundary (BCH transaction finality). An activated period can settle immediately under v0.2.0; there is no additional end-of-period wait. Eligible offers come from the entire authenticated frozen roster. Ranking compares exact `bigint` cross products of S×T/R and breaks ties by registration slot. The covenant independently requires every eligible competitor to rank below the proposed winner. Empty snapshots use the covenant's empty-period transition. The keeper never cancels, registers, refunds or signs owner withdrawals.

One confirmed transition per vault per poll avoids optimistic persistent state. Pending registry spends cause the keeper to wait. After confirmation it reconstructs the new state, settles or activates the next period, and repeats sequentially through downtime backlog. A finite horizon terminates advancement. Rejected transactions and competing-spend races are reported and retried, without changing the indexed state. No miner is built into the service; regtest operators/tests must mine blocks. A pending transaction that never confirms can stall progress until BCHN confirms or evicts it; no fee replacement is implemented.

Each keeper instance uses its own checkpoint and API port. The CLI holds a Linux abstract Unix socket lock derived from the absolute checkpoint path; the OS releases it on crashes, and graceful shutdown holds it until an in-flight poll finishes. Sharing a checkpoint path is rejected. Use one canonical absolute path (avoid symlink aliases). Library callers must enforce the same single-writer rule. Independent instances can use different keys, policies and stores: their transactions contend for the same canonical on-chain inputs, so only one spend can confirm. Losing keepers resynchronize. Coordination is not part of protocol correctness.

## Permissionless fee sponsorship

Without sponsorship the keeper uses the covenant's exact fee deductions: 10,000 sats per transition plus a 2,000-sat settlement allocation carrier. It refuses to eat the remaining reward-cap reserve. A BCH-only sponsor input uses the existing extra-input branch, preserving the vault's reserve apart from its exact winning reward. On settlement the sponsor also pays the allocation carrier. There is no sponsor change output: the entire sponsor input less any required carrier becomes transaction fees. Provision bounded outpoints intentionally; do not pass arbitrary wallet UTXOs.

The `Sponsorship` library callback can supply any compatible BCH-only input/unlocker. The CLI adapter supports an explicitly configured list of `RegistryDeposit` outpoints controlled by a separate environment-provided key. The service never creates, funds or replenishes these outputs. Outpoints are checked against BCHN including the mempool, the key's deposit script and absence of tokens. Missing sponsorship leaves a fee-constrained vault waiting with a retry diagnostic. Mempool policy can still reject an undersized sponsor. There is no keeper reward or claim of economically incentivized liveness.

## Running

Start the existing node with `mise exec -- npm run node:start`. Create a private JSON config, replacing placeholders with a confirmed vault's actual genesis and immutable parameters:

```json
{
  "vaults": [{
    "genesis": "GENESIS_TRANSACTION_ID",
    "stakingCategory": "FUNGIBLE_TOKEN_CATEGORY",
    "epoch": 1794000000,
    "periodSeconds": 60,
    "periods": 3,
    "cap": 1000
  }],
  "checkpoint": "/home/omarchy/bch-staking/.regtest/arena/keeper-a.json",
  "port": 3100,
  "pollMs": 2000,
  "keeper": true,
  "sponsorOutpoints": []
}
```

Run `mise exec -- npm run arena -- /absolute/path/config.json`. Set `keeper` to false for indexing/API only. Optional `ARENA_SPONSOR_KEY` is the sponsor's 32-byte private key in hex, supplied through the environment; keep it out of config, shell history and Git. No default keeper key exists. The tests use disposable, deterministic regtest-only keys. For a second independent instance, use another checkpoint path and port. SIGINT/SIGTERM stop gracefully; SIGKILL recovery uses the last durable checkpoint.

The API binds IPv4 localhost and accepts GET only:

- `/health`: readiness, last successful update, last error and indexed tip.
- `/vaults`: all admitted active vaults.
- `/vaults/:category`: status, outpoints, full witness, BCH reserve, escrow, backlog, offers, snapshot, rankings and history.
- `/vaults/:category/offers`, `/rankings`, `/periods`, `/allocations`, `/withdrawals`, `/history`: corresponding projections.

Each successful data response includes chain, tip hash/height/MTP, confirmed-only status and health. BCH/token totals are decimal strings. Offer terms are bounded integers. Withdrawal eligibility means eligible at the indexed MTP and state; it still requires the owner's signature, live UTXOs and an accepted transaction. Allocation eligibility is independent of current registry phase. Live rankings before activation are provisional. There are no HTTP write, signing, funding or broadcasting endpoints.

## Validation and limitations

The [verification report](keeper-indexer-verification.json) records seven passing original regression cases and two passing new integration cases. It also retains the initial full-suite daemon harness failure: expected chain-change retry diagnostics were incorrectly treated as fatal. The corrected harness and both new tests passed in the focused rerun; both raw run logs are preserved.

Run `mise exec -- npm run typecheck`, `mise exec -- npm run test:arena` and `mise exec -- npm test` with BCHN running. Run serially: the arena test gracefully stops/restarts the node and invalidates only blocks created by that test. It always attempts node restart/reconsideration in cleanup. It preserves the pre-test block hash and milestone tag. Tests append regtest transactions and blocks; they do not delete or replace the wallet or chain directories. Evidence is recorded in `keeper-indexer-test-result.json`; existing milestone evidence is historical.

The automated integration test covers registrations in dependent same-block transactions, full witnesses, sponsored catch-up over three overdue periods, competing keepers, covenant rejection of altered/omitted offers, idempotent polls, disk replay, actual BCHN disconnection/reconnection, independent allocation withdrawal, multi-block rollback/replacement, fresh reconstruction, process crashes/restarts, GET endpoints and UTXO balance/token reconciliation.

This is a small-chain implementation. It requires archival, unpruned BCHN with txindex and the existing cookie/wallet/RPC setup. JSON journals and full projection replay grow with relevant history; there is no pruning, database migration framework, pagination, subscription, production monitoring, remote RPC configuration or load testing. Block processing and reconciliation assume a trusted node; UTXO verification is an explicit diagnostic, not an atomic chain-wide snapshot. Mempool transitions are deliberately absent from the API. The service does not auto-discover vault parameters or offer unrestricted remote access. Linux ownership locks match the current environment. There is no independent adversarial review or production-readiness claim.
