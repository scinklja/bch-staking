# Configurable marketplace confirmation visibility

The browser marketplace defaults to `VITE_MIN_DISPLAY_CONFIRMATIONS=0`. Set it at build time to `1` or a larger nonnegative integer to display only state transitions at that depth. Vault genesis and offer registration use the same threshold. It is deployment configuration, with no user toggle. The Pages build script preserves an explicitly supplied value and otherwise builds with zero.

`ElectrumIndexer.vaults` and its durable checkpoint remain the canonical confirmed projection used by wallet spending and settlement. `displayVaults` is a separate, disposable projection; it never supplies spending authorization. The browser worker publishes this projection with explicit transaction status and confirmation counts. Confirmed API consumers retain their existing projection.

Mempool replay fetches raw bytes, verifies transaction IDs, discovers dependencies in topological order, checks source histories for exact and competing spends, checks finality, and runs the BCH 2026 VM with the exact source outputs, including CashTokens. Genesis retains the factory authorization, immutable parameters, reserve, scripts, NFT commitment and output checks. Only this display path opts out of the genesis confirmation gate after VM verification. No covenant source or compiled covenant is changed.

Two independently configured Electrum hosts must agree on the tip and all relevant histories before pending entries can be published. Unreachable peers are retried through the remaining configured hosts; contradictory reports withhold pending listings. Height 0 and -1 both mean unconfirmed, never confirmed. Histories are reread before publication; changed tips, conflicts, missing dependencies, invalid covenants and provider disagreement withhold the pending projection. The next successful scan rebuilds it from current reports. Drops and replacements therefore remove or replace the old entry; stable category/slot keys avoid duplicate listings when confirmations arrive. Existing confirmed Merkle proofs, header ancestry and reorganization replay are preserved.

The wallet journal distinguishes submission awaiting observation, observed 0-conf, confirmation, conflict, dropped/replaced, and unavailable/disagreeing providers. A missing transaction is labelled dropped/replaced only after prior observation and missing reports from both providers; RPC failure alone does not establish a drop. A submitted genesis is added to the local candidate catalog immediately and recovered automatically from the journal when the wallet worker starts, including before a wallet is connected. Candidate configuration is not admission: listing still requires verified genesis. A funded pregenesis factory is not a completed vault. Shared pending genesis imports use the same validated display path.

Pending snapshots are not restored as current data from localStorage or IndexedDB. Reload reconstructs them from current Electrum histories and source transactions; saved confirmed checkpoints are explicitly historical until reverified. Existing funding/preparation confirmation requirements and live wallet/settlement verification remain in force. Registration is disabled against a pending state outpoint in the UI.

## Local validation

Only local BCHN **regtest** and offline/mock Electrum responses are used. No chipnet transaction is broadcast, queried live, or verified end to end for this change.

`npm run test:mempool` uses a test-only Electrum facade over the local cookie-authenticated regtest node. The production chipnet identity checks are not bypassed or extended to regtest. The test covers an actual BCHN-accepted unconfirmed funding/factory/genesis/registration chain, thresholds 0/1/2, a pending registration on an already confirmed vault, stable identity on confirmation, checkpoint reloads before and after confirmation, provider disagreement, disappearance, competing and replacement transactions, VM rejection of a malformed covenant transition, and rejection of a factory as genesis. Contradictory/replacement Electrum reports are mocked using locally constructed regtest transactions.

The existing regression suite is run explicitly with `ARENA_NETWORK=regtest`, excluding `chipnet*.test.ts` and the separately run new mempool test. Existing Electrum/browser-wallet regression fixtures replay offline; their historical network labels are not live verification. Frontend tests run with `npm --prefix frontend test -- --testTimeout=20000` to accommodate the shared machine. Typechecks and the production build are separate checks.

## Limits

Discovery remains based on the deployment catalog, local created/imported candidates and shared vault configurations; it is not a global scan of arbitrary token transactions. Visibility follows polling and provider agreement, so providers that have not observed a transaction can delay its appearance. An invalid or contradictory pending graph withholds all pending listings for that scan and reports the reason; confirmed listings remain available under their existing checks. Oversized histories and dependency graphs withhold pending state at the configured safety limits. Both mempool and chain views can change between polls. Electrum agreement does not provide a consensus guarantee or replace confirmation. The separate v2 recovery UI is unchanged.

The existing public GitHub Pages repository receives compiled assets only. Publication preserves its prior commit and a rollback branch/bundle. Mainnet remains disabled.

## Validation results and release record

All 52 existing regression cases passed across the full run and the allocation rerun. The allocation test initially stopped at its `networkactive=false` environment precondition; resetting the local regtest flag allowed its full standard-policy checks to pass. The dedicated mempool suite passed after all implementation changes. The full frontend suite passed 53 tests; targeted receipt tests passed three cases including one additional contradictory-confirmation case, journal startup recovery passed two cases, and final presentation/schema checks passed fifteen cases. All fourteen selected marketplace/indexer/wallet/settlement browser cases passed across the run and the targeted IndexedDB rerun. Root and frontend typechecks passed.

The browser test harness trusts its temporary loopback WSS certificate and isolates native wallet tests from the page’s independent keeper. IndexedDB-failure coverage targets the bootstrap worker and verifies that only stale confirmed data remains after pending state is withheld.

See [the machine-readable validation and deployment record](zero-confirmation-deployment.json) for the source/deployment commits, compiled asset hashes, Pages status, rollback details and test scope. Production verification fetches static files only and never executes the deployed client against public Electrum.
