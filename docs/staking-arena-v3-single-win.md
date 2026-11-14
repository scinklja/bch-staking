# One-win offers in the v3 application

New v3 offers created through the updated application have exactly three inputs:
stake S, duration T and requested reward R. The application fixes maxWins to 1,
commits S once, and requests one reward payment R. After that claim, the unchanged
covenant records one win, the offer is completed, and existing ranking logic
excludes it from the active queue. The stake remains in its independent allocation
until its consensus MTP lock matures; withdrawal still requires the owner wallet.
Fees and CashToken carriers remain separate from the staking commitment.

This is an application policy, **not a consensus-level restriction**. No covenant
source, compiled bytecode, vault parameters, queue architecture, ranking or release
rules change. Other software or older application versions can still create
multi-win offers accepted by the existing covenant.

The form and its fresh-state validation use validateNewOffer. AssetWallet.offer
rejects new requests unless maxWins is exactly 1 before scanning wallet funds.
New offer journals include an optional offerPolicy: single-win tag. Tagged plans
are revalidated during transaction construction, authorization, submission and
recovery; their limit cannot silently become multiple wins.

Journals created before this change have no policy tag. They keep their exact
original terms, collateral and signed bytes and remain resumable with explicit
wallet approval. Already registered multi-win offers retain their remaining wins,
full remaining commitment, cancellation/refund path, independent allocations and
withdrawals. The UI identifies those legacy offers and their remaining payments;
completed offers remain visible in recovery, outside the active ranked queue.
No database version or storage key changes and no journals are rewritten en masse.

The action-time verification and stale-display fix are preserved. Display age
alone never disables an otherwise eligible action. Fresh canonical replay,
UTXO checks, exact signed-plan validation, caller-funded fees, durable journaling,
identical-byte recovery and reorganization protections remain in place. V1/v2 and
mainnet guards are unchanged. Deployment checks use public chipnet read-only;
no funded chipnet transactions or physical Cashonize approvals are performed.

Verification uses focused frontend tests for the three-input form, S commitment,
fixed maxWins, completion/queue removal, stale-display behavior and signing;
existing WSS browser regressions; existing synthetic chipnet four-asset-pair
regressions for legacy journals and withdrawals; and BCHN wallet/claim integration
regressions for new single-win offers and legacy multi-win recovery. Release
results and source/site commits are in the adjacent deployment record.

Verified results: 28 focused frontend tests, three WSS browser regressions, six
synthetic chipnet regressions (no public network), and both existing BCHN wallet
and claim integration tests passed. Root/frontend typechecking, standard
production build and chipnet Pages build passed. The release bundle also passed
read-only two-provider chipnet browser checks. All five v3 covenant artifacts
are byte-for-byte identical to starting commit 76a1c2e. The build retains its
existing large-chunk warning. Public release hashes and final commits are
recorded in `staking-arena-v3-single-win-deployment.json`.
