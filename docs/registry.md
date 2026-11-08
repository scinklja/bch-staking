# Staking Arena: independent on-chain allocations

The current registry commits **S × W fungible CashTokens upfront** for stake S and maximum wins W. Every win transfers exactly S into a separate independently withdrawable `StakeAllocation` UTXO and pays reward R in BCH in the same transaction. Later wins never modify an earlier allocation. Ranking, canonical registration order, complete activation snapshots and fixed UTC periods are unchanged; no frontend functionality is added.

This is a BCHN regtest implementation, not an audited production deployment. The [legacy single-stake implementation and verification](registry-legacy.md) are retained with their code, tests and existing development UTXOs. New constructor/bytecode and record semantics require a **fresh validated genesis**. Existing instances retain their immutable original rules; no existing chain or wallet is reset or deleted.

## Canonical instance and assets

`Registry` binds a unique mutable, non-minting state-NFT category (the vault ID), an immutable staking fungible-token category, UTC epoch E, period length L in seconds, finite horizon N ≤ 16 and per-period BCH cap C. There is no administrator update or arbitrary child-template parameter.

The state NFT and fungible stake have different categories, so they occupy separate outputs. Genesis output 0 holds the empty state NFT and funded BCH reward/fee reserve; output 1 is an empty 1,000-satoshi `StakePool`. Registration adds real tokens of the configured category. The test asset has a finite fungible supply and no minting NFT; a vault can bind another validated existing fungible category.

Genesis admission is still a client validation boundary: pin the actual genesis outpoints, exact compiled scripts/parameters, one unique state NFT, absence of minting authority for its category, empty state and pool, and adequate reward, carrier and fee funding. BCH token genesis rules alone do not force a creator to choose safe settings or unique state authority. An address or independently funded lookalike is not the canonical vault.

## Authenticated registry and unchanged selection

The NFT commitment is `hash256(state)`. The fixed witness is 1,574 bytes: period (4), phase (1), count (1), all 16 live records (16 × 49), and all 16 snapshot records (16 × 49). Each record contains owner compressed public key (33), S token units (4), T whole periods (4), R BCH satoshis (4), W (1), wins (1), cancelled (1) and remaining-escrow-refunded flag (1). There is **no shared latest-maturity field**. An unrefunded offer's outstanding commitment is `S × (W − wins)`.

REGISTER authenticates the owner's signature, requires slot == count, increments count once, initializes counters/flags to zero and freezes owner/terms. Slot is the canonical registration sequence; capacity is 16 lifetime registrations with no recycling. This means canonical state-spend order, not earliest wall-clock or mempool arrival. Miners and reorgs can change canonical order.

Eligibility is `!cancelled && !refunded && wins < W` in the activated snapshot. ACTIVATE copies the complete live roster, including ineligible entries and flags. No keeper-supplied subset is accepted. Ranking compares every eligible slot using `A.S × A.T × B.R` versus `B.S × B.T × A.R`; exact ties go to the lower slot. S and R keep the 1,000–1,000,000 bounds, R ≤ C, and 1 ≤ T,W ≤ N. Ranking products are at most 16 × 10^12; total remaining stake is at most 16 × 16 × 10^6 units.

## Coupled registry and token pool

Every transition spends state at input 0 and pool at input 1, returning successors at outputs 0 and 1. `StakePool` rejects spends without the bound state NFT at input 0. `Registry` validates the exact pool script, 1,000-satoshi carrier, token categories, empty NFT commitments and input/output amounts derived from authenticated records. The state covenant authorizes every pool movement.

| Action | Consensus checks and effects |
| --- | --- |
| REGISTER (0) | Phase 0, unused slot, valid owner-signed terms. Input 2 supplies **exactly S × W tokens** of the configured category and 10,000 BCH satoshis for the fee. Pool increases by S×W; state BCH is unchanged. |
| CANCEL (1) | Owner-signed; sets only the live cancelled flag in either phase. Snapshot and remaining escrow stay intact. Cancellation itself pays no refund. |
| ACTIVATE (2) | Phase 0, p < N, timestamp CLTV at B(p). Copies every live slot to the snapshot, entering phase 1. Registration and remainder refunds are blocked. |
| SETTLE (3) | Phase 1, full-roster ranking/ties/W verified. Output 2 pays exactly R BCH; output 3 locks exactly S tokens in the precisely derived allocation. Winning counter increments once; p advances by one; phase returns to 0. |
| REFUND REMAINDER (4) | Phase 0, owner signature, cancelled, not already refunded, positive remainder. Sends exactly `S × (W − wins)` tokens to the owner and marks refunded. Already allocated tokens are never refunded through the registry. |
| ADVANCE EMPTY (5) | Phase 1; all sixteen slots prove no eligible entry exists. Advances one period without reward/allocation. |

SETTLE has exactly two inputs and four outputs: state, pool, reward and allocation. REGISTER has three inputs/two outputs; REFUND two inputs/three outputs; other actions two inputs/two outputs. Extra inputs/outputs, arbitrary destinations and alternate state changes fail.

Losing consumes zero stake. Cancellation cannot release a frozen winner's collateral. While any period is activated, all **unallocated commitment refunds** remain blocked until settlement/empty advancement. After settlement, a cancelled offer can reclaim only the unallocated remainder. Exhausted offers have no remainder to refund. This hold never applies to already created allocation UTXOs.

Only one period activates at a time. Delayed catch-up remains sequential; out-of-order settlement is unsupported and rejected. Cursor jumps, rollback, reopening, duplicate settlement, conflicting spends and confirmed replay cannot create another reward/allocation for one period.

## Independent allocation identity and release

Each allocation has an immutable 110-byte constructor payload:

| Field | Bytes | Registry-derived source |
| --- | ---: | --- |
| Owner | 33 | Snapshot compressed public key |
| Vault ID | 32 | Canonical state-NFT category |
| Offer ID | 1 | Authenticated slot |
| Winning period p | 4 | Current authenticated cursor |
| Stake S | 4 | Immutable snapshot terms |
| Scheduled maturity | 4 | B(p + T) |
| Staking category | 32 | Registry constructor |

Its canonical identity is `(vault ID, offer ID, winning period)` and the actual settlement outpoint at output 3. Discovery must validate that outpoint's canonical registry lineage. Allocations hold real fungible CashTokens; they need no new receipt NFT or retained minting capability. Externally funded lookalikes are not extra canonical wins.

`scripts/compile-registry.mjs` compiles `StakeAllocation.cash` and `StakePool.cash`, pins their exact executable bodies in `Registry.template.cash`, generates `Registry.cash` and compiles the parent. SETTLE derives the complete allocation redeem script on-chain (`PUSHDATA1 110 + derived payload + pinned body`) and requires its P2SH32 locking script, exactly S tokens of the configured category, empty NFT commitment and a 2,000-satoshi carrier. It derives the pool script similarly. **No caller- or genesis-selected template can substitute an unsafe child contract.** Recompile/review parent and children together if either child changes.

`StakeAllocation.withdraw` requires the actual owner's signature, timestamp CLTV at its own maturity, exactly one input (itself), and exactly one owner P2PKH output returning all S tokens of the same category. Its 2,000 BCH carrier funds a fixed 1,000 fee and returns 1,000 satoshis with the tokens. It cannot change owner, maturity, amount or category, burn stake, or recreate another lock. A changed redeem script fails P2SH authentication; the consumed allocation cannot withdraw twice.

Withdrawal requires **no registry or pool input, no shared phase and no keeper authorization**. A later win creates a new outpoint with its own maturity. The first matured allocation can withdraw while two later ones remain locked and another registry period is activated but unsettled. Already created allocations remain independently spendable even if the registry later stalls.

## Fixed UTC periods and delayed settlement

`B(p) = E + p × L`. Reward period p is `[B(p), B(p+1))`. T is whole periods; each allocation matures at B(p+T). No actual activation/settlement timestamp replaces that boundary. Bounds E ≥ 500,000,000, L > 0 and `E + (2N−1)L ≤ 2,147,483,647` preserve timestamp-type locktime and positive four-byte Script-number encoding.

Settlement after B(p+T) still pays R immediately and creates an already time-mature allocation. Its withdrawal can spend the unconfirmed settlement successor, permitting both transactions in one block when valid. There is no fresh T-period wait after late acceptance.

BCH timestamp finality uses parent median-time-past (MTP); declared locktime must be strictly below that cutoff for inclusion. Consensus does not guarantee inclusion at an exact UTC wall-clock instant. Eligibility freezes at actual canonical activation: pre-activation registration/cancellation can affect a period after its nominal boundary; post-activation cancellation preserves the snapshot. See [CashScript time locks](https://cashscript.org/docs/language/globals), [CashTokens introspection](https://cashscript.org/docs/design/cashtokens) and [BIP113](https://bips.dev/113/).

## Reserves, conservation and fees

Registry checks pool tokens against the sum of all unrefunded `S × (W−wins)` **before and after every transition**. REGISTER adds S×W, SETTLE removes S, REFUND removes only the remainder; other actions preserve token balance. Exact destinations/amounts supplement consensus token conservation to reject burning, underfunded allocations, stake reuse and category substitution.

BCH reserve is separate from stake tokens. The exact state-value equation subtracts:

- REGISTER: zero; its fee is funded externally.
- SETTLE: 10,000 fee + R reward + 2,000 allocation carrier.
- REFUND: 10,000 fee + 1,000 refund carrier.
- Other transitions: 10,000 fee.

Pool carrier stays 1,000. State successor must hold at least `(N−nextPeriod) × C + 1,000`. Unused C−R stays in the reserve; arbitrary surplus outputs fail. Genesis must additionally fund the finite worst-case transition/carrier budget. Reward coverage alone is insufficient. No general top-up or final surplus recovery exists; fee exhaustion can strand remaining pool escrow, **but cannot disable independent allocation withdrawals**.

## Enforcement boundaries and limitations

| Property | Enforcement boundary |
| --- | --- |
| Owner authorization, immutable terms, S×W escrow, assigned canonical sequence | Registry and BCH signatures |
| Complete frozen roster, full ranking, canonical tie order and W | Registry; no trusted TypeScript winner choice |
| Reward, S deduction, correct allocation and cursor advancement | One atomic registry/pool transaction |
| Per-win owner/identity/amount/category/maturity and independent withdrawal | Registry-derived pinned script plus standalone allocation covenant |
| No duplicate settlement/refund/withdrawal or stake reuse | State equations, token-pool balance equations and canonical UTXO spends |
| Fixed UTC arithmetic and maturity lower bounds | Timestamp CLTV/finality, without exact wall-clock execution |
| Safe unique genesis and fee provisioning | Client admission validation, not a universal creation factory |
| Prompt execution, witness availability, inclusion | Keeper/indexer/miner liveness |
| Public relay standardness, worst-case budgets, production security | Not proven by isolated regtest acceptance; independent review required |

Other limits: sixteen lifetime offers; finite N; no eligibility period lists; serial state/pool transitions; conservative activated-phase hold on unallocated refunds; no automatic keeper, generic genesis admission validator, indexer/reorg recovery or production deployment; fixed fees/carriers; no reserve recovery. Asset issuance economics are the creator's configuration responsibility. Empty immutable NFTs can be indistinguishable from no NFT in FT introspection; allocation identity relies on canonical outpoints and script-bound metadata, never an empty receipt NFT.

## Reproduction and evidence

Run `mise exec -- npm run node:start`, then `mise exec -- npm test`. Tests use only existing `127.0.0.1:18443/wallet/dev`, check regtest/network isolation, append blocks/transactions and verify the previous checkpoint remains an ancestor. They do not reset/delete data, roll back the chain, change clocks, loosen policy or access an external chain. Run serially because the development provider shares UTXO scans.

`tests/allocations.test.ts` covers real S×W deposits, all sixteen slots, complete-roster ranking/ties, malformed allocation fields, underfunded token/BCH allocations, reward/reserve tampering, pool theft, stake reuse, cancellation/refunds, three independent wins, first-only maturity withdrawal during an unrelated activated period, early/unauthorized/changed/duplicate withdrawal, late same-block settlement/withdrawal and empty catch-up. Positive transactions are broadcast/mined; negative cases call BCHN `testmempoolaccept` on unspent inputs, not merely SDK simulation or spent-input errors. Each rejection is not separately attempted in a handcrafted invalid block.

Legacy tests now use `LegacyRegistry.cash` and `legacy-registry.ts`, preserving historical safety/counterexample coverage. Original infrastructure, deadline-counterexample and bounded-vault tests remain. New evidence is in `docs/allocations-test-result.json`.

## Verified results

On 2026-11-08, the independent-allocation integration test passed in **175,668.371454 ms** on /Bitcoin Cash Node:29.2.0/: **39 accepted cases, 40 expected adversarial rejections, 60 tracked transactions confirmed**. Compilation of parent/children and TypeScript checking passed in the full run.

The winning offer deposited 18,000 tokens (S=6,000, W=3), paid one 1,000-satoshi BCH reward per win, and created:

| Winning period | Tokens | Immutable maturity UTC | Canonical allocation outpoint |
| --- | ---: | --- | --- |
| 0 | 6000 | 2026-11-08T22:52:00+00:00 | `ef17fead1146c37dc1808dbf046c535388241076f5f1d5f3afb709e31b5f7ddc:3` |
| 1 | 6000 | 2026-11-08T22:53:00+00:00 | `51dc7acb05ff7ec4439c788be6be82f32b507979922a4499303590adcfed8df1:3` |
| 2 | 6000 | 2026-11-08T22:54:00+00:00 | `8c9c0444db3e3625934273f4e207837ce95636c46a49875571b850c6d333906b:3` |

Withdrawal `5a332b06bb3723fb30a19b35bee49e648bd2112b5b866a217e71cf099849e2a0` released only the first allocation while the other two were still consensus-immature and period 3 was activated/unsettled. Subsequent actions on that unrelated period were not needed to authorize the withdrawal.

The separate delayed instance settled after its scheduled maturity `1794168340` with parent MTP `1794178325`. Settlement `0debc6725e0d06771318f9196dcd93ecb940e2d7c5f1fc8d011e623e2949a389` and independent withdrawal `411808da066bab07a3b5dba4940bf57882a84c32dd189d22f32a29c0f75e4996` confirmed in the same block `579cf1c77f98b348a21d11aafca39dee18cd0258342edca5d7a1e7a87e810da0`; maturity was not extended. Its cancelled offer recovered exactly 12,000 unallocated tokens after one 6,000-token allocation.

The allocation test preserved its starting checkpoint at height 820 (`1ce7c5a04072e16a65d5f9133a7794303a19d4471d9606a6b7193cd68e944631`) and appended through height 930. There was no chain reset, wallet replacement, clock override or history rewrite. Sizes: registry 2116 bytes, pool 93 bytes, allocation 230 bytes (including its immutable terms), state witness 1574 bytes.

Two preliminary fixture runs caught declared-locktime and duplicate-refund rejection-classification issues in the test builder. The fixture was corrected; neither required weakening the covenant. The final full-suite results follow.

Final command: `mise exec -- npm test`. Compilation and TypeScript checking passed. Integration runner: **6 tests, 6 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo; 371,914.132372 ms**.

| Integration case | Result | Runtime (ms) |
| --- | --- | ---: |
| Independent CashToken allocations (current implementation) | PASS | 175668.371454 |
| Local BCHN funding / invalid spend / confirmation | PASS | 1629.773521 |
| Deadline counterexample / irrevocable period | PASS | 73930.752152 |
| Legacy single-stake verification and historical counterexample | PASS | 10073.801777 |
| Legacy 16-offer UTC registry | PASS | 84687.999925 |
| Original bounded vault | PASS | 5350.972738 |

Full output: `docs/allocations-test-run.txt`. Detailed current evidence: `docs/allocations-test-result.json`. The legacy counterexample still describes the retained old contract, not the new allocation implementation. The retained legacy executable bytecode was compared with the pre-change artifact and is identical. No unrelated Git history was modified.
