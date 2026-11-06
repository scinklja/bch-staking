# Cancellation cutoff investigation

## Finding

Do not describe the original UTC cancellation or submission deadline as trustless. With the available BCH primitives, an otherwise-valid spend cannot be made to expire at an absolute time merely by inspecting its own locktime. A permissionless CLOSE transaction does not fix this. While the OPEN outpoint is unspent, cancellation and CLOSE can race after the nominated cutoff; miners can select the cancellation. Earlier eligibility for CLOSE does not give it consensus priority.

BCH can preserve fixed UTC *labels* and a chain-time **lower bound** for settlement. It cannot provide exact current wall-clock UTC to these covenants, or a generic upper-bound transaction expiry. See [BIP65](https://documentation.cash/protocol/forks/bip-0065.html), [BIP113](https://documentation.cash/protocol/forks/bip-0113.html), and [CashScript time variables](https://cashscript.org/docs/language/globals). This conclusion is based on the primitive semantics as well as the concrete regtest attack below; one attack test alone is not a proof covering all possible future protocols.

## Why the naive canonical state machine fails

Proposed naive transitions:

- OPEN -> OPEN: submit or cancel, with `tx.locktime < cutoff`.
- OPEN -> CLOSED: anyone may close, with `tx.time >= cutoff`.
- CLOSED -> SETTLED: anyone proves the maximum eligible offer and pays it.

`tx.locktime` is a transaction field chosen by its author, not the inclusion time. CashScript's guard on locktime introspection prevents disabling its lower-bound semantics, but does not turn it into current time. `CHECKLOCKTIMEVERIFY` checks compatible time types, non-final sequence, and a minimum transaction locktime. Transaction finality compares timestamp locktime against the previous block's MTP (strictly less than MTP). An old timestamp becomes final and remains final as time advances. `CHECKSEQUENCEVERIFY` similarly supplies a minimum age, not a maximum.

Take a valid owner-signed cancellation with an old timestamp below cutoff. Leave its input unspent. Advancing chain time does not invalidate its signature, script, or finality. Constructing and signing it *after* cutoff is equally possible. Checking `tx.locktime >= 500000000` avoids a height/timestamp confusion but does not remove this attack. Refusing late transactions in TypeScript or hiding the cancellation button has no consensus effect.

CLOSE only removes cancellation when it actually consumes the state. An MTP lower bound on CLOSE cannot forbid a conflicting cancellation first. A keeper fee incentive, presigned close, delegated closer, or many independent keepers improves service but cannot guarantee inclusion or precedence. An exact upper block-height expiry is not available through these fields either. Checking a caller-supplied old header establishes that old time existed, not that it is still current. A proposed authenticated header/state-proof system needs separate analysis; none is implemented here.

Submission has the same problem: a submit transition with old locktime can register after nominal cutoff until the relevant state is consumed. Therefore changing only cancellation does **not** preserve the original full specification. This limitation must be explicit in any protocol amendment.

## Smallest defensible amendment

Make activation into a specific period's eligible set **irrevocable**. A cancellation request cannot remove an already activated offer from that period or withdraw its committed stake. It may affect future unactivated commitments, or an unregistered draft. Keep UTC boundaries as the earliest chain-time settlement schedule. Define admission/activation and snapshot boundaries through the canonical on-chain state sequence, rather than claiming an absolute UTC latest-submission time.

This changes two distinct semantics, both necessary if no additional trust is acceptable:

1. Replace “cancel active offers until UTC cutoff” with “an offer is binding for a period once activated; cancellation only affects unactivated eligibility.” This removes the late-cancellation winner manipulation entirely, rather than hoping a keeper wins a race.
2. Replace “all submissions must precede exact UTC cutoff” with an explicit on-chain admission rule. A close-defined admission boundary can be delayed and admit late offers. If that exposure is unacceptable, use a previously sealed, immutable roster for the period (as this experiment does); do not assert its sealing happened before a UTC deadline unless that claim has a separate proof/assumption. Future registration remains unimplemented. Keeping exact UTC submission and cancellation deadlines instead requires an additional trusted admission/time authority or new consensus primitives; it is not achieved here.

UTC epoch/length, reward cap, offer terms, phase transition rules, and the nominated cutoff remain immutable for an instance. This does not require an administrator to select the winner or settle. It does give up cancellation flexibility. Simply replacing UTC cutoff with the actual CLOSE time while still allowing cancellation prevents cancellation *after CLOSE*, but allows post-UTC cancellation to manipulate the roster during delayed closure, so that weaker amendment is **not** recommended for the stated threat model.

## Experimental state machine actually tested

`PeriodOpen.cash` commits a cutoff and the exact CLOSED output script. The entire three-offer roster is already immutable and economically binding; OPEN means “not yet transitioned to the settlement script,” **not** “offers remain cancellable.” It has no submit or cancel function. Any caller may close after the chain-time lower bound and must produce exactly the committed script/value, subtracting the fixed close fee. No signature authorizes closure.

CLOSED is the existing `Vault.cash` contract. It checks the complete three-offer set and exact ranking via bounded cross multiplication, immutable array-order ties, reward/reserve amounts and all payout destinations. Its only spend is terminal settlement; no transition recreates OPEN. SETTLED is represented by consumption of the unique fixture outpoint and its payout outputs, not a freely re-creatable phase flag or an NFT. Independent lookalike outputs are different vault instances. The original restrictions still apply: BCH stake surrogate, no registration history, no token baton, and lock template construction verified by the fixture rather than derived by Vault bytecode. Read [the earlier architecture](staking-architecture.md).

`DeadlineProbe.cash` is a separate, intentionally unsafe counterexample. It authenticates cancellation with an actual Schnorr owner signature, fixes the refund destination/value, and checks an absolute timestamp locktime below cutoff. It also offers a permissionless lower-bound CLOSE branch. Its successful post-cutoff cancellation is an expected **security failure of that design**, not a feature of the safe experiment. Never deploy this probe as a deadline mechanism.

The fixture chooses a cutoff on a fixed 10-second UTC grid. It uses real time and normal regtest mining; no `setmocktime`, chain rollback, reset, external RPC, or host-file access is needed. It deliberately withholds CLOSE, waits beyond cutoff, then mines enough blocks for MTP to exceed it. Evidence records the previous block's MTP for mined spends, so block timestamp or wall-clock checks are not mistaken for the consensus finality reference. Tests append blocks/transactions to the existing isolated chain and leave its normal clock settings intact.

## Adversarial cases and expected observations

| Case | Unsafe deadline probe | Irrevocable period experiment |
| --- | --- | --- |
| Cancellation before cutoff | Owner-signed refund accepted and mined | Active cancellation/refund output rejected; intentional protocol change |
| Cancellation after cutoff, before CLOSE | Newly signed old-locktime refund accepted and mined with parent MTP beyond cutoff | Redirecting state to refund is rejected even though OPEN remains unspent |
| Closure before cutoff | Not relied upon as a cancellation solution | Future locktime is non-final |
| Delayed closure | Does not expire the cancel branch | OPEN remains available; permissionless CLOSE accepted and mined later |
| Settlement following delayed closure | Not a ranking prototype | Correct winner accepted and mined; exact reward paid |
| Reopen CLOSED | Not tested on probe | Attempted return to OPEN rejected by transaction shape constraints |
| Lower-ranked or later tied winner | Not a ranking prototype | Both rejected by BCH script evaluation |

Negative cases call BCHN `testmempoolaccept` on unspent inputs and assert specific script/finality errors. Positive cases are actually broadcast and mined. The unsafe cancellation is constructed and signed only after the delay, and actual inclusion is confirmed. The suite does not pretend a mempool conflict alone proves a deadline, nor that each rejected transaction was placed in a separately constructed invalid block. Existing vault replay/concurrency tests remain intact.

## Enforcement, liveness, and assumptions

| Property | Status |
| --- | --- |
| Immutable script-bound settings, payout shape, roster, ranking | BCH consensus for the bounded fixture |
| No removal of active roster entries, no reopen, one terminal spend | BCH consensus for the canonical fixture outpoint |
| No CLOSE/settlement before lower bound | BCH finality/CLTV with chain MTP, not exact wall UTC |
| Exact UTC upper submission or cancellation bound | **Not enforced; unsafe design explicitly counterexample-tested** |
| Successful settlement despite arbitrarily late CLOSE | Safety preserved; execution requires a caller and miner inclusion |
| Automated invocation at a nominated time | Keeper software/liveness; consensus does not schedule transactions |
| Availability of witnesses and transaction fees | Keeper/indexer/user liveness; no privileged backend required |
| Canonical independently submitted offer order | Not implemented; constructor roster order only. Future serialized registration must assign ordinals |
| Fixed 10-second UTC alignment | Fixture construction in TypeScript; contracts bind supplied cutoff but do not derive/validate the grid |
| Correct CLOSED/lock template and funding setup | TypeScript construction checks; OPEN commits a supplied CLOSED script, not a genesis factory proof |
| No administrator control over winner/closure | No signature required in safe close/settle branches; canonical genesis still must be authenticated |
| Owner-authorized unsafe cancellation | BCH signature verification, using a public regtest fixture key |
| Absolute clock truth, censorship resistance, prompt confirmation | Not supplied by these covenants; normal chain/miner/reorganization assumptions apply |

If the original exact UTC upper deadlines are non-negotiable, stop before production marketplace work. An oracle/committee or sequencer would add authority over timing/admission, even if ranking is subsequently verified by script. A claim that an operator signs only before cutoff is an operator policy, not BCH enforcement. A simple signed timestamp is insufficient: it can also be replayed later unless the design addresses freshness and already-authorized conflicting transactions. Even an online signer cannot make an already signed transaction expire by wall time under these primitives. Any oracle/committee alternative must specify what it attests, how eligibility is adjudicated, and what time/admission trust replaces the original requirement. No such authority is added here.

## Reproduction and evidence

Run `npm run node:start`, then `npm test`. Tests are serialized. The period test waits roughly a minute for actual UTC time and normally mines a small batch of blocks to cross MTP; allow up to three minutes on a slow machine. Inspect `docs/period-test-result.json` for accepted/rejected transaction IDs, cutoff, observed MTP, mined confirmations and actual closure delay. The other two existing tests also run. All RPC calls use the existing client at `127.0.0.1:18443/wallet/dev`, guarded by regtest checks.

## Recorded final run

On 2026-11-06, `npm test` passed compilation, TypeScript checking and all **3 integration tests (0 failures)** in approximately 96 seconds. The cutoff was 1793959920 (`2026-11-06T10:12:00+00:00`). The unsafe post-cutoff cancellation was mined with previous-block MTP 1793959933, 13 seconds after cutoff. Delayed CLOSE and valid settlement both confirmed. Pre-cutoff confirmation was asserted below cutoff in both parent MTP and observed wall time. Specific script rejection assertions passed for active cancellation redirects, reopening, lower-ranked selection and later equal-ranked selection. Original lifecycle, reserve, payout, replay and conflict checks still pass.
