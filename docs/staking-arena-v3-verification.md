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


## Final check results

All six v3 test groups passed. The 59 protocol cases from the aggregate run were
verified across the aggregate and corrective reruns; three additional mocked
chipnet cases passed (62 unique protocol cases total). All 70 frontend tests,
TypeScript checking and the production frontend build passed. The build reports
its existing large-chunk warning.

The first `npm test` run reported 55 passes, three failures and one cancellation.
One failure was an error-message compatibility assertion, corrected by preserving
the existing chipnet wording. Real-clock deadline/registry tests inherited future
MTP; the relay policy test also exposed a frozen peer clock during investigation.
The clock-sensitive fixtures now use disposable BCHN nodes with the existing
100ms local relay timing, and the peer clock adjustment was removed. The deadline,
registry, policy and allocation tests all passed on rerun, with their assertions
preserved. The browser-keeper suite passed all eight cases. A fresh single aggregate
run after these corrections was not performed; these are explicitly combined
results from the aggregate and targeted reruns.

`staking-arena-v3-verification.json` records the checks and artifact hashes.
`staking-arena-v3-test-run.txt` retains the historical aggregate failures and the
successful corrective runs, including the intermediate policy retry. The latest
public claim flow was rerun after confirmed sponsorship verification was added;
it verifies persistence before broadcast, lost acknowledgement, reorg rollback,
cancellation/refund and independent relative withdrawal against BCHN.
