# Staking Arena: independent on-chain allocations

The current registry commits **S × W fungible CashTokens upfront** for stake S and maximum wins W. Every win transfers exactly S into a separate independently withdrawable `StakeAllocation` UTXO and pays reward R in BCH in the same transaction. Later wins never modify an earlier allocation. Ranking, canonical registration order, complete activation snapshots and fixed UTC periods are unchanged; no frontend functionality is added.

This is a BCHN regtest implementation, not an audited production deployment. The [legacy single-stake implementation and verification](registry-legacy.md) are retained with their code, tests and existing development UTXOs. New constructor/bytecode and record semantics require a **fresh validated genesis**. Existing instances retain their immutable original rules; no existing chain or wallet is reset or deleted.

## Canonical instance and assets

`Registry` binds a unique mutable, non-minting state-NFT category (the vault ID), an immutable staking fungible-token category, UTC epoch E, period length L in seconds, finite horizon N ≤ 16 and per-period BCH cap C. There is no administrator update or arbitrary child-template parameter.

The state NFT and fungible stake have different categories, so they occupy separate outputs. Genesis output 0 holds the empty state NFT and funded BCH reward/fee reserve; output 1 is an empty 1,000-satoshi `StakePool`. Registration adds real tokens of the configured category. The test asset has a finite fungible supply and no minting NFT; a vault can bind another validated existing fungible category.

`RegistryGenesis.create` now enforces creation on-chain. Fund its token-free output **at index 0**, then spend that output as the sole genesis input. Its transaction ID becomes the state category under CashTokens genesis rules. The factory derives the precise Registry script from that category, its immutable staking category/E/L/N/C and the pinned Registry body; it also derives the pinned pool script. Exactly two outputs are allowed: one mutable, non-minting state NFT committing to the all-zero 1,574-byte state, with no fungible amount, and the empty 1,000-satoshi pool. State funding must be at least N×C+1,000 and exactly the pregenesis input value minus 11,000 (1,000 pool carrier + 10,000 genesis fee). Permissionless creation cannot discard surplus reserve as extra miner fees. No second NFT, minting authority, extra output, or alternative parameter/script is permitted. Factory creation is permissionless and needs no creator signature.

Rewards remain **native BCH**, so there is no reward CashToken category to configure or substitute. The immutable staking category is enforced in the factory and every token movement. Scarcity/issuance policy of an externally selected staking asset remains an admission/economic decision; binding a category cannot remove pre-existing external minting authority.

`src/genesis.ts:verifyRegistryGenesis` reconstructs the compiled factory/registry/pool, verifies the genesis input's actual previous output and index, requires active-chain confirmation, and verifies the resulting outputs and budget. It returns canonical outpoints for the caller to pin. This adapter deliberately uses the existing local regtest RPC. An arbitrary directly minted lookalike can still be consensus-valid, but lacks the factory proof and is rejected by admission. No covenant can globally forbid unrelated users from creating lookalike scripts or make an arbitrary chosen asset scarce.

## Authenticated registry and unchanged selection

The NFT commitment is `hash256(state)`. The fixed witness is 1,574 bytes: period (4), phase (1), count (1), all 16 live records (16 × 49), and all 16 snapshot records (16 × 49). Each record contains owner compressed public key (33), S token units (4), T whole periods (4), R BCH satoshis (4), W (1), wins (1), cancelled (1) and remaining-escrow-refunded flag (1). There is **no shared latest-maturity field**. An unrefunded offer's outstanding commitment is `S × (W − wins)`.

REGISTER authenticates the owner's signature, requires slot == count, increments count once, initializes counters/flags to zero and freezes owner/terms. Slot is the canonical registration sequence; capacity is 16 lifetime registrations with no recycling. This means canonical state-spend order, not earliest wall-clock or mempool arrival. Miners and reorgs can change canonical order.

Eligibility is `!cancelled && !refunded && wins < W` in the activated snapshot. ACTIVATE copies the complete live roster, including ineligible entries and flags. No keeper-supplied subset is accepted. Ranking compares every eligible slot using `A.S × A.T × B.R` versus `B.S × B.T × A.R`; exact ties go to the lower slot. S and R keep the 1,000–1,000,000 bounds, R ≤ C, and 1 ≤ T,W ≤ N. Ranking products are at most 16 × 10^12; total remaining stake is at most 16 × 16 × 10^6 units.

## Coupled registry and token pool

Every transition spends state at input 0 and pool at input 1, returning successors at outputs 0 and 1. `StakePool` rejects spends without the bound state NFT at input 0. `Registry` validates the exact pool script, 1,000-satoshi carrier, token categories, empty NFT commitments and input/output amounts derived from authenticated records. The state covenant authorizes every pool movement.

| Action | Consensus checks and effects |
| --- | --- |
| REGISTER (0) | Phase 0, unused slot, valid owner-signed terms. Input 2 supplies **exactly S × W tokens** of the configured category and normally 10,000 BCH satoshis for the fee; with a sponsor, its BCH carrier may be ≥1,000. Pool increases by S×W; state BCH is unchanged. |
| CANCEL (1) | Owner-signed; sets only the live cancelled flag in either phase. Snapshot and remaining escrow stay intact. Cancellation itself pays no refund. |
| ACTIVATE (2) | Phase 0, p < N, timestamp CLTV at B(p). Copies every live slot to the snapshot, entering phase 1. Registration and remainder refunds are blocked. |
| SETTLE (3) | Phase 1, full-roster ranking/ties/W verified. Output 2 pays exactly R BCH; output 3 locks exactly S tokens in the precisely derived allocation. Winning counter increments once; p advances by one; phase returns to 0. |
| REFUND REMAINDER (4) | Phase 0, owner signature, cancelled, not already refunded, positive remainder. Sends exactly `S × (W − wins)` tokens to the owner and marks refunded. Already allocated tokens are never refunded through the registry. |
| ADVANCE EMPTY (5) | Phase 1; all sixteen slots prove no eligible entry exists. Advances one period without reward/allocation. |

Without sponsorship, SETTLE has two inputs/four outputs, REGISTER three inputs/two outputs, REFUND two inputs/three outputs, and other actions two inputs/two outputs. Each permits **exactly one optional final BCH-only sponsor input**. All output counts, destinations and token equations remain exact. Further inputs/outputs and alternate state changes fail.

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

`StakeAllocation.withdraw` requires the actual owner's signature, timestamp CLTV at its own maturity, itself at input 0, at most one optional BCH-only sponsor input, and exactly one owner P2PKH output returning all S tokens of the same category. Its 2,000 BCH carrier funds a fixed 1,000 fee and returns 1,000 satoshis with the tokens. It cannot change owner, maturity, amount or category, burn stake, or recreate another lock. A changed redeem script fails P2SH authentication; the consumed allocation cannot withdraw twice.

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

Pool carrier stays 1,000. State successor must hold at least `(N−nextPeriod) × C + 1,000`. Unused C−R stays in the reserve; arbitrary surplus outputs fail. Genesis must additionally fund the finite worst-case transition/carrier budget. Reward coverage alone is insufficient. No general top-up or final surplus recovery exists. **Fee exhaustion is recoverable through an optional BCH sponsor input**, without modifying the authenticated state transition, terms, ranking, snapshot, ownership, token balances or maturity. The unsponsored equations above remain supported unchanged.

With sponsorship, state BCH is unchanged for REGISTER/CANCEL/ACTIVATE/REFUND/ADVANCE EMPTY, and decreases by exactly R for SETTLE. The sponsor pays fees and the fixed 2,000 allocation or 1,000 refund carrier. Sponsor inputs must have empty token category and zero token amount; NFTs, minting authority and fungible tokens are rejected. Output counts stay exact, so the sponsor receives **no change**. All BCH left after fixed outputs is miner fee. Sponsors should prepare one suitably sized BCH UTXO, authorize the complete transaction with SIGHASH_ALL, and inspect the actual fee before signing. Registration additionally contributes its token-input BCH to fees. Independent withdrawal retains its original 2,000 input / 1,000 owner-output equation; its optional sponsor adds BCH to the original 1,000 fee.

A reward-only factory genesis N×C+1,000 therefore needs no prepaid fee or future carrier budget when external sponsors are available. Fee funding cannot repair missing reward backing, change an old deployment's immutable bytecode, replace an owner's required signature for registration/cancellation/refund/withdrawal, or force a miner to include a transaction. Multiple funding UTXOs can be consolidated upstream into one sponsor UTXO; arbitrary extra covenant inputs/change outputs are intentionally unsupported. Sponsorship is voluntary and does not appoint an operator or require the vault creator. There is no automatic sponsor discovery or fee market service.

## Enforcement boundaries and limitations

| Property | Enforcement boundary |
| --- | --- |
| Owner authorization, immutable terms, S×W escrow, assigned canonical sequence | Registry and BCH signatures |
| Complete frozen roster, full ranking, canonical tie order and W | Registry; no trusted TypeScript winner choice |
| Reward, S deduction, correct allocation and cursor advancement | One atomic registry/pool transaction |
| Per-win owner/identity/amount/category/maturity and independent withdrawal | Registry-derived pinned script plus standalone allocation covenant |
| No duplicate settlement/refund/withdrawal or stake reuse | State equations, token-pool balance equations and canonical UTXO spends |
| Fixed UTC arithmetic and maturity lower bounds | Timestamp CLTV/finality, without exact wall-clock execution |
| Safe unique genesis and reward provisioning | Pinned genesis covenant plus confirmed factory-lineage admission; fees/carriers can be externally sponsored |
| Prompt execution, witness availability, inclusion | Keeper/indexer/miner liveness |
| Public relay standardness | Tested separately under BCHN standard policy with a loopback P2P peer; heterogeneous public-network/miner policy remains outside the covenant |

Other limits: sixteen lifetime offers; finite N; no eligibility period lists; serial state/pool transitions; conservative activated-phase hold on unallocated refunds; no automatic keeper/sponsor, general-network admission service, indexer/reorg recovery or production deployment; fixed unsponsored fees/carriers; no reserve recovery. Asset issuance economics are the creator's configuration responsibility. Empty immutable NFTs can be indistinguishable from no NFT in FT introspection; allocation identity relies on canonical outpoints and script-bound metadata, never an empty receipt NFT.

## Reproduction and evidence

Run `mise exec -- npm run node:start`, then `mise exec -- npm test`. Tests use the existing `127.0.0.1:18443/wallet/dev` and a temporary local peer on ports 18445/18446, check regtest/network isolation, append blocks/transactions and verify the previous checkpoint remains an ancestor. They do not reset/delete data, roll back the chain, change clocks, loosen policy or access an external chain. The current allocation test temporarily enables networking only to a fresh loopback-only regtest peer, then restores network inactivity; both nodes use `acceptnonstdtxn=0`. Temporary peer datadirs are retained for inspection. Run serially because the development provider shares UTXO scans.

`tests/allocations.test.ts` covers real S×W deposits, all sixteen slots, complete-roster ranking/ties, malformed allocation fields, underfunded token/BCH allocations, reward/reserve tampering, pool theft, stake reuse, cancellation/refunds, three independent wins, first-only maturity withdrawal during an unrelated activated period, early/unauthorized/changed/duplicate withdrawal, late same-block settlement/withdrawal and empty catch-up. Positive transactions are broadcast/mined; negative cases call BCHN `testmempoolaccept` on unspent inputs, not merely SDK simulation or spent-input errors. Each rejection is not separately attempted in a handcrafted invalid block.

Legacy tests now use `LegacyRegistry.cash` and `legacy-registry.ts`, preserving historical safety/counterexample coverage. Original infrastructure, deadline-counterexample and bounded-vault tests remain. Historical independent-allocation evidence is retained in `docs/allocations-test-result.json`; current milestone evidence is in `docs/security-test-result.json` and `docs/policy-test-result.json`.

## v0.2.0-regtest checkpoint verification

The latest implementation was compared against `origin/master` at `4404da9071787e901765003ee11168e25ea081dd`. Both branch histories matched before the milestone commit; the complete uncommitted source/contracts/tests/docs delta was reviewed. No covenant implementation was changed for this checkpoint: all 13 contract source hashes matched the pre-run manifest after recompilation.

Fresh command: `mise exec -- npm test`. Compilation and TypeScript checking passed. **7/7 tests passed, zero failures/cancellations/skips/todos, 603,141.181853 ms**: all six original integration cases plus the new standard-policy control. The current allocation/security case passed in **379,592.807855 ms** with **71 accepted cases, 103 expected rejections and 113 tracked transactions relayed before mining and confirmed on both nodes**, including a fee-payer key distinct from the initial funder and stake owner. Measurements and maximum-bound 16-offer settlement resources match the table below. The separate policy-control case passed in **25,341.970270 ms**, confirming oversized-data rejection on both standard-policy nodes and successful relay/confirmation of the smaller control.

The checkpoint preserved starting height **1537** (`6db01ab497da4e558d9a5865f055a6fe41b7ffdfa2b28055558c3b35a4c0eb4d`) and appended through **1776** (`16b1764a63c65257af908837305d6cdd9a0746bfe07b63a80503d40cc32d195e`). Original milestone height 1037 remained an ancestor. The development node finished with **networkactive=false and zero peers**. No clock override, chain reset, wallet replacement, policy relaxation or Git-history rewrite was used.

Current evidence: `docs/checkpoint-v0.2.0-test-run.txt`, `docs/checkpoint-v0.2.0-verification.json`, `docs/checkpoint-v0.2.0-covenants.sha256`, `docs/security-test-result.json` and `docs/policy-test-result.json`. Earlier standalone results are archived as `docs/security-precheckpoint-result.json` and `docs/policy-precheckpoint-result.json`; older result sections below are historical. Wallet-balance values are redacted from publishable runner logs; wallet files, RPC cookies, environment credentials and actual private credentials are excluded. Deterministic regtest fixture keys are intentionally public. The [security-review checklist](security-review-v0.2.0.md) identifies unproven properties and remaining operational risks; passing integration tests is not an audit or proof of public-network relay compatibility.

## Fee recovery, genesis and standard relay milestone (2026-11-09)

Current sources: `Registry.template.cash`, `StakeAllocation.cash`, `RegistryGenesis.template.cash`, `src/genesis.ts`, `src/relay-peer.ts`, `tests/allocations.test.ts`, and `tests/policy.test.ts`. Compilation pins allocation/pool bodies in Registry and then Registry/pool bodies in the genesis factory. Recompile all three layers together; a newly compiled address does not upgrade any deployed instance.

Verification distinguishes four observations:

1. **Consensus acceptance:** transactions included in blocks accepted by both BCHN nodes. This is positive confirmation evidence, not a claim that every malformed transaction was independently submitted in an invalid block.
2. **Mempool policy acceptance:** `testmempoolaccept` with `acceptnonstdtxn=0`, including exact reject reasons on unspent inputs. Script failures, token-conservation failures, non-finality and insufficient relay fees are distinct results.
3. **Successful relay:** after submitting a tracked transaction only to the development node, the test waits for its ID in the independent peer's mempool **before mining**. It never RPC-submits that transaction to the peer. The peer is not whitelisted and has no permission to bypass policy.
4. **Block confirmation:** the development node mines; the peer receives/validates the block, and every tracked transaction is checked confirmed on both nodes. Both finish on the same tip.

These are real P2P exchanges between local regtest nodes, **not a broadcast onto the public BCH network**. BCHN 29.2.0 standard-policy compatibility is evidence for that release and activated rules, not a guarantee of every public relay/miner policy. Mainnet/testnet funds and external peers are never used. `txbroadcastinterval=100` milliseconds accelerates local inventory announcements only; default fee thresholds, script limits, standardness and validation remain enabled. Tests restore the development node's inactive network setting and retain the peer's temporary datadir path in evidence.

The relevant BCHN 29.2.0 [policy implementation](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/v29.2.0/src/policy/policy.cpp) and [limits](https://github.com/bitcoin-cash-node/bitcoin-cash-node/blob/v29.2.0/src/script/vm_limits.h) distinguish the post-May-2026 10,000-byte scriptSig/script limit from the historical 1,650-byte policy limit. Standard transaction size is at most 100,000 bytes. The fixed state push is 1,574 bytes. Standard operation budget is `(scriptSigBytes + 41) × 800` per input, standard hash-iteration allowance is `floor((scriptSigBytes + 41)/2)`, and stack+altstack limit is 1,000 items. Resource metrics in the evidence are SDK VM measurements for the full maximum-bound settlement; BCHN mempool/relay/confirmation provide independent acceptance checks. No legacy 201-op assumption is used for the active VM.

Security coverage includes zero fee reserve, insufficient sponsor fees, unrelated fee funding, sponsored registration/activation/settlement/cancellation/refund/withdrawal, BCH carrier funding, token-bearing sponsors, surplus inputs/outputs, stolen withdrawal destinations, token substitution, malformed/underfunded factory genesis, swapped immutable parameters and minting authority. Existing independent allocations, full snapshots, tie order, late settlement, phase holds and fixed maturities remain covered. A second full 16-entry roster sets N=T=W=16 and S=R=C=1,000,000; it checks maximum-bound ranking and rejects entry 17.

Remaining risks: no audit or production deployment; voluntary sponsor liveness and transaction assembly; donation-only fee inputs without change; immutable old deployments; asset issuance economics; canonical outpoint pinning and reorg handling; witness/indexer availability; finite horizon and lifetime capacity; fixed carrier amounts may be incompatible with some future policy. Factory prefunding must be deliberately constructed at output index 0 with sufficient BCH for its two outputs and fee; funds sent to a different index or insufficient prefunding cannot use this factory's sole-input creation path. Its creation fee is fixed at 10,000; transition fee sponsorship begins after genesis. The genesis verifier is a regtest adapter, not an external-chain indexing service. A zero-fee policy rejection does not itself prove consensus invalidity. Rejected attacks are tested against the mempool, not individually mined into invalid blocks.

### Results and measurements

`mise exec -- npm test` passed **6/6 tests**, no failures/skips, in **547,256.098355 ms**. Cases: current allocations 348,826.872853 ms; infrastructure 2,139.980030 ms; deadlines 81,013.665398 ms; legacy verification 7,958.219179 ms; legacy 16-offer registry 87,864.367792 ms; bounded vault 4,031.700327 ms. This full run preceded the final genesis surplus-conservation check and the 1,000-satoshi registration-carrier fixture. Its complete output and security evidence are retained as `docs/security-test-run.txt` and `docs/security-suite-result.json`; no legacy executable body changed.

The final-covenant run, `mise exec -- npx tsx --test tests/allocations.test.ts`, then passed **1/1**, no failures/skips, in **388,060.691995 ms** (runner 390,011.534253 ms): **71 accepted cases, 103 expected rejections, 113 tracked transactions relayed before mining and confirmed on both nodes**. It used the exact genesis value equation, an isolated correctly-fee-funded but reward-underfunded genesis, and sponsored registration with a 1,000-satoshi token carrier. Evidence: `docs/security-allocation-run.txt`, `docs/security-precheckpoint-result.json`.

This final run preserved height **1400**, hash `0d2525be41605cde99c3f88af100e4b7bf9897ebf5974757a3752da6ad201133`, and appended through height **1531**, hash `7a2753975492c7993001c03c8625e459d6062f9a56bb0e7f717d8a62852cae57`. The session's original height **1037**, hash `0da2963e6317e8f58b4fcdb392bbf91d669b4aad92f17a6d3b9d5bb42b027638`, also remained an ancestor. Preliminary fixture runs appended data too; none reset/replaced the wallet or chain, changed clocks, weakened policy or rewrote Git history.

| Accepted transaction | Serialized bytes | Fee (satoshis) | Fee rate (sat/byte) |
| --- | ---: | ---: | ---: |
| Factory genesis (representative) | 2712 | 10000 | 3.6873 |
| Unsponsored activation, full roster | 4281 | 10000 | 2.3359 |
| Unsponsored first settlement | 4396 | 10000 | 2.2748 |
| Sponsored registration, 1000 token carrier | 4615 | 16000 | 3.4670 |
| Sponsored activation, reward-only reserve | 4423 | 15000 | 3.3914 |
| Sponsored settlement, reward-only reserve | 4501 | 13000 | 2.8882 |
| Sponsored remainder refund | 4457 | 14000 | 3.1411 |
| Independent withdrawal | 439 | 1000 | 2.2779 |
| Sponsored independent withdrawal | 582 | 16000 | 27.4914 |
| Maximum-bound slot 15 registration | 4618 | 25000 | 5.4136 |
| Maximum-bound full-roster settlement | 4543 | 13000 | 2.8615 |

A focused replay with a separate fee-payer key also passed: `mise exec -- env STAKING_RECOVERY_ONLY=1 npx tsx --test tests/allocations.test.ts`, **1/1** in **65,805.465461 ms** (runner 69,114.890455 ms), **11 accepted / 30 rejected / 15 relayed and confirmed transactions**. Fixture keys are distinct: initial funder key 100, stake owner key 101, fee payer key 199; the full public keys are recorded in `docs/fee-recovery-test-result.json`. This demonstrates fee/carrier funding without the initial funder signing the fee input, including the 1,000-satoshi registration token carrier. `STAKING_RECOVERY_ONLY=1` runs the recovery/genesis cases without repeating the previously verified UTC timing and maximum-roster cases. Output: `docs/fee-recovery-test-run.txt`.

The independent policy control passed: `mise exec -- npx tsx --test tests/policy.test.ts`, **1/1** in **25,620.225709 ms** (runner 27,975.540352 ms). Both standard-policy nodes rejected the 433-byte transaction carrying a 227-byte OP_RETURN script as **`64: oversize-op-return`**. With the same unspent input, the smaller 203-byte OP_RETURN script produced a 409-byte transaction accepted by both nodes, then relayed from the development node and confirmed on both, paying 1,000 satoshis. This positively checks standardness enforcement rather than relying solely on configuration files. The oversized case was not submitted in a block. Evidence: `docs/policy-precheckpoint-result.json`, `docs/policy-test-run.txt`.

After these focused checks the chain reached **1537**, hash `6db01ab497da4e558d9a5865f055a6fe41b7ffdfa2b28055558c3b35a4c0eb4d`. The original checkpoint still matched, the development node had **networkactive=false, zero peers**, and Git HEAD remained `4404da9071787e901765003ee11168e25ea081dd`. Prior historical evidence files and unrelated executable artifacts were preserved. No implementation changes followed the final covenant verification; the later fixture change separated the fee-payer signing key and added the policy control.

Fees are actual BCHN `testmempoolaccept` base fees divided by serialized bytes, not fee estimates. Standard minimum relay fee was 1 sat/byte on both nodes. A 2,000-satoshi sponsor on a 2,000-carrier settlement left **zero fee** and was rejected as `min relay fee not met`; it is not classified as a covenant/consensus rejection. Accepted transaction sizes were **439–4618 bytes**, maximum accepted scriptSig **3949 bytes**, representative registry redeem script **2251 bytes** (constructor integer encodings vary), pool **93**, allocation **247**, state witness **1574**.

The maximum-bound instance deposited **256,000,000 tokens** across 16 offers, each S=1,000,000, T=W=N=16 and R=C=1,000,000. The full roster activated, the lower-slot tie winner settled, and offer 17 was rejected. Settlement input 0 measured **7,160 evaluated instructions**, **1,247,175 / 3,152,800 operation cost (39.56%)**, **99 / 1,970 hash iterations**, and zero signature checks; the separate sponsor input used one signature check. Cumulative pushed bytes were 509,383, which is **not peak stack occupancy**. BCHN acceptance verifies applicable stack limits; peak stack occupancy was not separately instrumented. No 17-offer capacity or larger horizon is claimed.

## Historical independent-allocation results (before this milestone)

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
