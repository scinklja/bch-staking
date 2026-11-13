# V3 verification and delivery

Development branch: `dev/staking-arena-v3`.

Implementation entry points:

- `contracts/v3`: registry, full-funding genesis, paired asset roles, independent CSV allocations, public fee sponsorship.
- `src/v3/model.ts`: virtual buffer, live queue decisions and deterministic state updates.
- `src/v3/protocol.ts`: genesis, registration, cancellation, claim, refund and withdrawal builders.
- `src/v3/indexer.ts`: portable browser/Node canonical replay, proof verification and reorg recovery.
- `src/v3/wallet.ts`: WizardConnect unsigned plans, strict signed-byte validation and durable operation recovery.
- `src/v3/claim.ts`: wallet-independent sponsored claims and durable claim recovery.
- `frontend/src/V3Arena.tsx`: `#/v3`, creation, discovery/import, queue, offers, claims and allocation recovery.

## Required scenarios

| # | Scenario | Evidence |
|---|---|---|
| 1 | Multiple reward releases accumulate | Model boundary assertions and real BCHN claims after three completed intervals |
| 2 | Releases without offers | Real BCHN browser replay verifies an empty queue with the full virtual buffer |
| 3 | Register between releases | Real BCHN continuously registers competitors between the third and fourth releases |
| 4 | Register after accumulation | Real BCHN registration after three releases |
| 5 | Exact ranking | Live queue tests, direct VM tied/lower winner rejection, maximum BigInt operands |
| 6 | Higher rank displaces lower | Real BCHN higher-stake registration changes the head immediately |
| 7 | Anyone invokes claim | Actual BCHN claims have no owner authorization; public FeeSponsorV3 flow needs no wallet |
| 8 | Only head receives payment | Direct adversarial VM construction and BCHN recipient-diversion rejection |
| 9 | Insufficient buffer fails | Builder rejection and actual BCHN rejection using a backdated final locktime |
| 10 | Lower offer cannot bypass head | Direct VM claim construction independently bypasses client guards and is rejected |
| 11 | Reject registration R > reserve | Model/builder rejection and signed, fully funded malicious registration rejected by VM |
| 12 | Repeated independent stake locks | Two real claims per asset pair, distinct allocation terms/outpoints, early CSV rejection |
| 13 | Remove after W wins | Real BCHN queue checks after the second win |
| 14 | Cancellation preserves locks | Real BCHN browser replay, unused commitment refund and later independent withdrawal |
| 15 | BCH/token accounting | Exact source, reserve, escrow, carriers and payout checks plus actual BCHN theft/burn rejection |
| 16 | Four asset combinations | Real BCHN BCH/BCH, BCH/token, token/BCH, token/token and same-category token/token |
| 17 | Competing claims cannot duplicate | Actual BCHN rejects independently funded competing claims and duplicate raw transactions |
| 18 | Reorg restores state | Actual winning block invalidation/reconsideration with browser queue/buffer/allocation replay; portable branch rollback |
| 19 | No early rewards | Exact model boundaries, CLTV/locktime VM checks and actual BCHN pre-release/future/final-sequence rejection |
| 20 | No keeper or wallet required | Actual public donation + RewardClaimer, and frontend test with no wallet context |

The direct VM tests deliberately bypass safe transaction builders. Payout and state
mutations in the real BCHN claim suite affect transactions without signatures, so
rejection cannot be attributed merely to an invalidated sponsor signature.

## Evidence files

- `staking-arena-v3-results.json`: actual BCHN asset-pair transactions and rejections.
- `staking-arena-v3-browser-results.json`: actual BCHN wallet-plan, public sponsor, claim and reorg replay results.
- `generalized-assets-v3-max-resources.json`: full queue size and VM budget measurements.

The tests sign wallet templates locally with deterministic test keys. They do not
establish that a physical Cashonize/WizardConnect wallet supports regtest. Frontend
component tests mock the worker boundary; the actual protocol/indexer integration
runs separately against local BCHN. Browser WSS transport follows the existing
Electrum implementation, with local endpoint/genesis restrictions for v3.

## Compatibility and deployment

No v1/v2 contract or state format changes. New v3 configs, IndexedDB journals and
claim journals are isolated. Shared Electrum support adds explicit local regtest
while retaining chipnet defaults and rejecting mainnet. Shared signed-plan
validation keeps the existing validator by default; v3 supplies its CSV-aware
validation after rechecking canonical allocation maturity.

Existing vaults remain on their original scripts. Migration means a separately
funded v3 genesis and explicit new registrations, without changing or sweeping old
allocations. There is no deployment or live chipnet verification in this change.
See `staking-arena-v3.md` for timing, accounting, inherited limits and unresolved
security/deployment questions. Passing regtest is not production readiness.


## Current complete review gate

The fresh full review gate supersedes the initial aggregate plus corrective reruns
recorded by commit `57f742b`. All stages now pass in one invocation. See
[the review and decisions](staking-arena-v3-review.md),
[the current machine-readable result](staking-arena-v3-verification.json), and
[the fresh full run log](staking-arena-v3-review-run.txt).

The older `staking-arena-v3-test-run.txt` is retained as historical evidence only.
The standalone supervisor lifecycle test remains opt-in and outside this gate.
