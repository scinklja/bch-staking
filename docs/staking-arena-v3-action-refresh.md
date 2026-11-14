# V3 action-time verification

V3 display snapshots no longer expire transaction buttons after thirty seconds.
The display retains the ranked queue, reserve, buffer, schedule, offers and
allocations, labels older data, and refreshes on each initiated vault action.
The most recently saved vault opens automatically on return to v3. No additional
chain polling is introduced.

Make an Offer explains wallet compatibility, invalid terms, capacity, pending
state spends and existing journal operations beside the button. Claims,
cancellations, unused commitment recovery and withdrawals likewise explain known
blocking conditions, including ownership. Aged time-dependent eligibility can
be rechecked by clicking; the worker remains authoritative for consensus MTP.
A failed refresh keeps the old display, marks it outdated and requests no wallet
approval. Changed claim state updates the display and requires another click.

The worker replays canonical state on two independent providers before preparing
funding and again before authorization. New funded plans record their relevant
canonical source; a changed source rejects authorization or submission. Resumed
unsigned covenant plans are prepared anew and require a fresh explicit approval.
Legacy journals without the optional source field remain readable and still get
fresh eligibility and input verification. Claims retain their existing exact
winner, source and plan-identity checks. Every signed submission retains signed
plan validation, VM execution, BCH/CashToken conservation, external fees,
durable journaling, peer UTXO checks and the immediate pre-broadcast input check.
Identical-byte transaction recovery and reorganization replay are preserved.

Covenant artifacts, queue architecture, reward rules, v1/v2, existing vault
configurations and browser journal names/schema are unchanged. Mainnet stays
disabled. Deployment testing connects to public chipnet providers read-only;
no funded chipnet transactions or real Cashonize approvals are performed.

Focused verification covers aged buttons (including owner actions), refresh on
offer initiation, changed claim state, refreshed claim eligibility, invalid
parameters, fresh capacity exhaustion, provider failure, automatic opening,
pre-approval source changes, wallet signing refusal and recovery. Existing
browser WSS/reorganization and BCHN wallet/claim integration tests supplement
frontend tests, root/frontend typechecking and production/Pages builds.
Release-specific commit IDs and final results are recorded separately.

Validation: root and frontend typechecking, standard production and chipnet
Pages builds passed. The focused v3 run passed 25 tests. The full frontend run
passed 92 tests in 22 files. Three WSS browser tests and both existing BCHN wallet
and claim integration tests passed, including all four asset pairs. The build
retains the existing large-chunk warning. Public browser and asset-hash checks
are recorded in `staking-arena-v3-action-refresh-deployment.json`.
