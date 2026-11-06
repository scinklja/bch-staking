# Staking feasibility and bounded prototype

The [follow-up cancellation investigation](cancellation-deadlines.md) tests the deadline attack and an experimental irrevocable OPEN → CLOSED → SETTLED path; its protocol amendment is proposed, not an assertion that the original UTC deadlines work.

## Decision

A bounded auction with a complete authenticated offer set is feasible. The full specification, interpreted as exact wall-clock deadlines and globally earliest submissions, is **not** enforceable as written on BCH. Adopt explicit chain-time and serialized-registration semantics before building a production system. This implementation is an experiment, not a deployable staking protocol.

The existing environment, Example contract and test are retained. CashScript/cashc remain pinned to 0.14.0. No website, external chain access, wallet migration, or chain reset is introduced.

## Proposed production state machine (not implemented)

Publish immutable parameters: staking CashToken category, reward asset, UTC epoch and period length, finite period count N, per-period reward cap C, duration units and origin, offer size/range limits, registration policy, fee policy, and cancellation semantics. Require N*C reserve at genesis (or a separately specified exact per-period cap sum). A perpetual vault cannot predeposit an infinite reserve. Identify the actual genesis outpoint and token category; an address alone does not identify a vault.

Use a unique mutable, **non-minting** CashToken NFT as the state baton. No retained minting capability for that category. Covenant every successor, NFT category/capability, commitment, count, scripts, token amounts and BCH amounts. Inductively preserve parameter hash, current period, reserve liability, next submission ordinal, and a root of the entire offer registry. NFT uniqueness comes from authenticated genesis and constrained transitions, not merely possession of an arbitrary NFT. Commitment space is small (40 bytes); store a hash and small version/phase metadata there and reveal authenticated state as witnesses. Use bounded encodings and domain-separated hashes.

Registration must spend that baton and escrow the specified category and S tokens atomically. Authenticate ownership/authorization with transaction signatures, bind destination and all offer fields, verify the registry update, assign a strictly increasing ordinal, and return exactly one successor baton. The confirmed chain of baton spends is the submission order. A website timestamp, mempool arrival, transaction ID ordering, block transaction position, or a caller-supplied integer is not an authenticated arrival order. Miners can censor/reorder competing submissions; no script can recover an earlier real-world arrival time. Reorganizations can alter the canonical order.

Each offer contains S, positive R, T, ordinal, beneficiary, explicit eligibility period IDs/range, and live/accepted/cancelled status. Define whether T means seconds or periods and whether it starts at the period boundary or actual acceptance. For a useful minimum lock after delayed settlement, prefer acceptance-chain-time plus T; that origin needs careful specification and a non-backdatable chain-time anchor. Boundary-plus-T is simpler but may already have elapsed at late settlement. Rewards are a single R payout on acceptance under this report's interpretation; if R is instead owed for every period of T, reserve liabilities and selection semantics must change.

For the first extensible version, cap registry size and prove the complete registry in settlement. Verify its root, every escrow link, eligibility/status and all comparisons, then mark the winner consumed. Merkle membership alone proves neither completeness nor maximality. A scalable authenticated priority structure must validate *every insertion/update/removal*, with summaries that account for period eligibility and expiration. An ordinary score-sorted tree cannot prove the best currently eligible offer using only a membership path. Repeated eligibility makes this materially harder. Consider bounded period buckets with duplicate-reference accounting, or a separately audited authenticated tree design. Do not rely on a keeper supplying an honest winner or an indexer returning all offers.

Settlement spends the baton and winner escrow, authenticates the complete eligible set, pays exactly R to the committed beneficiary in the same transaction, recreates the reserve with liability reduced by C (and separately accounts for C-R surplus), records the period settled, and moves S tokens to an authenticated withdrawal covenant. Only a strictly sequential period cursor may advance. Empty-period advancement needs a proof that no eligible offer exists. A missed period must be processed or explicitly skipped by a defined rule; late acceptance must not silently drop an earlier eligible period. An accepted offer is removed from every future selection, while an unsuccessful live offer can remain eligible until its committed expiry. Distinct offers from the same staker are independent unless prohibited explicitly.

Competing settlements consume the same state UTXO. At most one confirms; others rebuild against the new state. Do not shard reserve state without a proof preventing two settlements for the same period. No administrator signature is required to settle. Permissionless execution provides safety, not guaranteed liveness: somebody must obtain witnesses and pay transaction fees. Keepers and indexers are replaceable, and missing witnesses can stall progress.

## Time: required specification changes

Fixed UTC boundaries can be encoded as integer Unix timestamps, but BCH timestamp locktime finality uses the previous block's median-time-past (MTP), not a wall clock. `tx.time >= boundary` compiles to a lower-bound locktime check. Non-final sequence numbers and timestamp-vs-height type compatibility matter. Finality requires the locktime to be below the applicable chain-time cutoff, so there is also a strict-boundary detail. Block timestamps and median filtering create delay and variance.

Scripts cannot read the current MTP directly. Critically, a low transaction locktime does **not** prove execution occurred before a deadline: an old transaction can be mined later. Cancellation or admission guarded only by `tx.locktime < boundary` is unsafe. There is no general exact upper-time-bound transaction expiry in BCH. An authenticated phase transition can close registration/cancellation, after which the state baton forbids them; it cannot guarantee a keeper closes the phase at an exact UTC instant. State the cancellation rule as “before the on-chain period-close transition,” or add a trusted time/ordering assumption, or redesign the protocol. Both admission cutoff and literal “cancel only before the period begins” need this change. Header/oracle proofs require a separate security analysis and do not give exact present UTC.

## Exact ranking and bounded computation

Require S,T,R > 0. Compare A.S*A.T*B.R with B.S*B.T*A.R; never divide, round, or use floating-point scores. Strict inequality against every earlier equal-ranked competitor and non-strict inequality against later competitors implements ordinal tie-breaking. Bound every operand *before* multiplication and document intermediate products. The prototype caps S,T,R at 10^6 (S and R at least 1000), so products are at most 10^18, below signed 64-bit maximum. It does not depend on enlarged BigInt capacity. Production token quantities and durations require new ranges or carefully costed wider arithmetic, not copied bounds.

CashScript compiles checks; BCHN consensus ultimately validates bytecode. Pin compiler, node version, and activated rules. Check redeem script/stack element limits, stack depth, signature checks, per-input operation/hash budget, transaction size, and standard relay policy independently. Modern VM rules allow larger arithmetic, but not unlimited execution. A registry scan scales linearly; an unbounded auction cannot fit one transaction. Standardness can be stricter than consensus. Measure adversarial worst-case witness sizes before selecting registry capacity or tree depth. Pagination is only safe with authenticated progress and frozen registry state; a caller must not omit pages or mutate already checked offers.

## Implemented experiment and its trust boundary

`contracts/Vault.cash` is a terminal, single-period vault with exactly three immutable offers in constructor data. All three stakes and the full single-period BCH reward cap are pooled in the funding UTXO. The roster is authenticated by its P2SH32 locking script; no witness can hide or replace a competitor. Genesis array order is the tie order. **There are no independent submission transactions**: the fixture creator chooses that order and fields. Thus this is authenticated ranking over an atomic roster, not proof of earliest independently authenticated submissions.

The covenant enforces one input, five exact output destinations/values, the complete bounded ranking, tie order, reward cap, minimum reserve, exact initial balance, lower-bound start locktime, stake allocation, loser refunds, reserve remainder and a fixed 1000-satoshi fee. The state UTXO is terminally consumed. Funding an address insufficiently is possible; spending such a malformed vault fails. A production genesis factory/registration check must reject malformed creation before anyone treats it as valid.

Output 0 pays R immediately; outputs 1–3 return losers' stakes and transfer the winner's stake to its constructor-committed lock address; output 4 returns unused single-period reserve to the creator. Winner stake remains there until `start + T` chain time, under the supplied `StakeLock.cash`. Withdrawal is permissionless but sends only to the owner with at most 1000 satoshis fee. A late settlement after the lock end provides no additional waiting time.

**TypeScript constructs and checks the intended lock addresses. Vault bytecode binds those addresses but does not prove they implement StakeLock or that their end equals start+T.** A malicious genesis could commit arbitrary lock scripts. Immutable parameters alone do not imply correct parameters. Production must derive/verify lock bytecode on-chain or require an authenticated genesis template with validated construction. The fixture also chooses genuine beneficiary wallet addresses and Unix-time start values; the covenant does not authenticate separate offer-owner signatures, require UTC alignment, or enforce a submission deadline.

BCH is deliberately a stake surrogate. CashTokens, a token-aware provider, registry transitions, multi-period reserves, cancellation, expiration, NFT uniqueness and repeated eligibility are **not implemented or tested**. The original provider still explicitly refuses token UTXOs. No TypeScript ranking decision is trusted in settlement: wrong winners are submitted to BCHN and rejected. The fixture uses no owner or creator signature to settle. Real wallet signatures are used only by the existing local regtest wallet to fund the fixture.

## Verification and reproduction

Start the existing isolated node with `npm run node:start`, then run `npm test`. Tests are serialized because the original provider uses global UTXO scans. RPC remains hardcoded to `127.0.0.1:18443/wallet/dev`; assertRegtest guards access. Network activity is disabled by the existing startup script. No data directory is replaced. Tests append blocks and local transactions to the existing regtest chain.

Both the original lifecycle test and the new bounded-vault test run. Negative transactions use BCHN `testmempoolaccept`, checking script/finality/conflict rejection rather than SDK simulation. Positive settlement transactions are broadcast and mined, demonstrating consensus acceptance. Rejection results distinguish script evaluation from mempool conflict/finality checks; this is not a claim that every rejection was tested in a separately mined invalid block. Replay is additionally broadcast after confirmation and rejected. Machine-readable evidence is in `docs/vault-test-result.json`; original test evidence remains in `docs/latest-test-result.json`.

Coverage: lower-ranked winner; later equal-score winner; wrong reward amount; insufficient reserve; before-start settlement; an earlier offer losing to a strictly higher score; valid tied and unique winners; competing settlement; confirmed replay; early withdrawal; confirmed exact payout and expected stake output. The fixture uses a historical, unaligned boundary intentionally: UTC alignment is not tested. Successful withdrawal after maturity and adversarial genesis/registration/token transitions remain future tests.

## Recorded result

`npm test` passed on 2026-11-06: compilation, TypeScript check, and both BCHN integration tests (2 passed, 0 failed). Consult the JSON evidence for transaction IDs; chain heights change across reruns. The serialized test run took approximately 15 seconds. Settlement size was 922 bytes and instantiated covenant size was 685 bytes. Independently valid competing settlements were checked before demonstrating mempool conflict. Only the existing local regtest endpoint was used.

## Recommended next work

1. Resolve chain-time cutoff semantics, finite vault horizon, duration origin/units, cancellation eligibility, reward liability and late/empty-period rules in a versioned protocol spec.
2. Add token-aware UTXO discovery without weakening the existing BCH-only provider. Implement and test genuine CashToken genesis, stake transfers, unique state NFT and template authentication.
3. Build a bounded serialized registration/close/settle state machine before attempting trees. Verify signatures, ordinal assignment, cancellation phases, multi-period eligibility and exact reserve invariants under consensus.
4. Add malformed token/capability, alternate genesis, missing-offer, invalid registry update, expiration, delayed settlement, concurrent registration, reorganization and maturity withdrawal tests. Measure maximum capacity and policy limits with actual witnesses.
5. Obtain independent covenant/security review before accepting funds. Build the website only after these state transitions are stable.

## Primary references

- [CashScript covenant introspection](https://cashscript.org/docs/design/covenants): transaction-local information; no global offer discovery.
- [CashScript CashTokens design](https://cashscript.org/docs/design/cashtokens): category/capability validation and minting hazards.
- [CashScript modular contracts](https://cashscript.org/docs/design/modular): authenticated covenant/state composition.
- [BCH transaction finality](https://documentation.cash/protocol/blockchain/transaction.html) and [BIP113](https://documentation.cash/protocol/forks/bip-0113.html): MTP locktime semantics.
- [VM limits specification](https://github.com/bitjson/bch-vm-limits): execution budgets and consensus versus relay size constraints. Deployment budgets must also be checked against the selected node's actual activated rules.
