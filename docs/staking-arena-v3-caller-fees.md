# V3 caller-funded claims

This change replaces the Claim reward interface's FeeSponsorV3 pre-funding requirement with one atomic wallet-funded transaction. V3 remains local-regtest-only. No deployment is included. The existing sixteen-slot queue, exact priority/tie breaking, no-skipping rule, release buffer, repeated wins and rounded CSV locks are unchanged.

## Transaction and accounting

| Index | Inputs | Outputs |
| --- | --- | --- |
| 0 | Canonical registry NFT/state | Updated registry NFT/state |
| 1 | Canonical staking escrow | Remaining committed stake |
| 2 | Canonical reward reserve | Remaining reward reserve |
| 3 | Caller wallet's confirmed, token-free BCH coin | Full reward R to the head offer's owner |
| 4 | — | Independent winning stake allocation |
| 5 | — | Optional token-free BCH change to exactly input 3's locking script |

Claims have exactly four inputs and five or six outputs. The covenant enforces the optional change script, absence of tokens/NFTs and minimum 1,000-satoshi change. It accounts for all six possible outputs and requires an exact 10,000-satoshi miner fee. Protected outputs retain their exact balances/carriers. Head selection and payout checks are unchanged and execute on-chain.

Caller cost = 10,000 sats miner fee + 1,000 sats for each new token-bearing reward/allocation output. Thus BCH/BCH costs 10,000 sats; either mixed pair costs 11,000 sats; token/token costs 12,000 sats. These carriers are additional BCH locked in the recipient reward/allocation outputs, not miner fees or a reimbursement to the caller. Allocation carriers eventually accompany the owner's mature withdrawal. Unused caller BCH returns as output 5. An exactly sized caller coin uses five outputs. No extra fee is burned to avoid change.

`RegistryV3.template.cash` and the embedded registry in `RegistryGenesisV3` are recompiled. `transitionBuilder` accepts optional caller change for action 3. `AssetWallet.claim` selects the fee coin and builds the single approval plan. `inspectClaim` provides public head/buffer/fee information without locating a donation UTXO. The browser worker routes new claims exclusively through the wallet engine. The browser indexer's existing replay handles the optional sixth output without changing protected role or allocation indices.

## Authorization and recovery

1. Replay genesis and canonical state across the configured local providers; reject pending vault spends, an ineligible head or insufficient buffer/reserve.
2. Scan the caller wallet's authorized derivation paths. Select the smallest suitable confirmed token-free BCH coin, excluding coins reserved by unfinished operations. Never select fungible token or NFT inputs for fees.
3. Verify all four sources across providers. Save the unsigned claim, state source, payer derivation and immutable plan to IndexedDB before approval.
4. Rebuild and compare the saved plan against current canonical state before authorization. WizardConnect/Cashonize receives the full transaction with `broadcast:false` and only input 3 in `inputPaths`. The live network/session and original wallet owner must still match. The caller is not required to own an offer.
5. Validate returned transaction fields against the approved plan, require the expected Schnorr ALL|FORKID|UTXOS signatures, verify covenant execution/finality and recheck unspent sources. Winner, reward, fee, carriers and change cannot be changed by the signing response. Persist signed bytes before broadcasting.
6. Broadcast acceptance is **pending**, never confirmation. Recovery records survive reloads. “Reconcile transaction status” performs verification without signing. Confirmation comes from canonical history/proofs. Outages retain signed bytes; competing confirmed state becomes conflicted. Explicit retry sends only the same signed bytes. There is no automatic reauthorization, replacement fee coin or fresh claim after uncertain submission.

Wallet rejection/disconnection leaves an unsigned operation and recorded error where the worker remains available. Users may explicitly approve the saved unsigned plan again or discard it. If a browser/worker connection is lost, reload and inspect the journal before taking further action. Old donation claim journals remain visible for read-only reconciliation; the new UI exposes no donation address or legacy retry path. FeeSponsorV3 remains unchanged for compatibility tests/historical source use.

## Targeted verification

- `npm run compile:v3`: compiled the updated registry and genesis.
- `ARENA_NETWORK=regtest npx tsx --test tests/v3-caller-claim.test.ts`: isolated BCHN test using real token genesis, explicit `testmempoolaccept`, broadcast, mining and indexer replay. Covers all four asset pairs, caller different from winner, full R, exact fee, BCH change, exact funding without change, token carriers, insufficient BCH, NFT exclusion, signed recipient/change/fee alterations, persisted-plan tampering, wallet rejection record, failed journal write and lost acknowledgement/reload recovery.
- `npm --prefix frontend test -- tests/V3Arena.test.tsx tests/v3WalletSigning.test.ts`: seven targeted UI/wallet bridge tests, including explicit authorization, refusal, unsigned error persistence, buffer blockage and no signing on uncertain recovery.
- `npm --prefix frontend run test:v3:browser`: two real-browser worker tests using loopback WSS fixtures, verified wallet-funded claim replay, pending/confirmed states, provider failure and reorganization handling. These do not exercise a physical wallet.
- `npm run typecheck` and `npm run frontend:build`: root/frontend TypeScript checks and production bundle.

Final targeted results: **PASS** — one BCHN integration test across four asset pairs (149.8 seconds), seven frontend/wallet bridge tests, two browser worker tests, root typecheck, frontend typecheck and production build. Build retains the existing large-chunk warning. No live chipnet or mainnet testing/deployment was performed.

Transaction evidence: [staking-arena-v3-caller-fee-results.json](staking-arena-v3-caller-fee-results.json). The previous full review at c156397 is historical evidence for the previous source, not a complete regression run for this covenant revision. The broader review and full v1/v2/v3 suite are deferred as requested.

## Limitations and compatibility

- This stage supports one confirmed BCH wallet input, not aggregation. A single coin must exactly cover the cost or leave at least 1,000 sats change; aggregate wallet balance alone is insufficient. No automatic consolidation or preliminary fee transaction is authorized.
- Fixed 10,000-satoshi fee, bounded wallet scan (initially forty children per authorized path), local provider availability and verified regtest wallet declarations remain constraints. Actual public Cashonize regtest support/signing has not been verified; tests use local signatures and a mocked WizardConnect bridge. No production-readiness claim is made.
- Changing the registry bytecode changes vault/factory addresses. Existing immutable v3 regtest vaults cannot be upgraded in place; use newly funded regtest vaults with the new artifacts. Historical v3 replay against old bytecode requires its matching old build. Do not fund/deploy public v3 vaults from this change.
- V1/v2 contracts and transaction logic are unchanged. Their complete regressions are intentionally deferred to Prompt 2. No migration of v1/v2 vaults is required.
- Accepted queue blockage, sixteen lifetime registrations, potentially stranded reward reserves, 512-second upward lock rounding and MTP versus wall-time differences remain as documented in the architecture. No remedies or queue redesign are added.
