# Generalized assets v2 verification

Verified locally on BCHN 29.2.0, CashScript 0.14.0, Node 24, and headless Chromium.
No additional chipnet funds were used. No mainnet or public website deployment was
performed. New real-wallet and public-chipnet compatibility remain unverified.

| Target | Result |
|---|---|
| V2 reference suite, `npm run test:v2` | 8/8 passed |
| Genuine BCHN transactions, all four pairs plus same-category tokens | 99 accepted, mined transactions; 130 rejected attacks |
| V2 wallet recovery and funded-factory safeguard, final targeted rerun | 4/4 passed |
| Legacy reference regressions | All 29 covered by the full sweep and corrected allocation rerun |
| Existing chipnet compatibility, local VM/network mocks | 3/3 passed; no new public-chain claim |
| Frontend unit/component tests | 39/39 passed across 13 files |
| Development browser/mobile smoke tests | 6/6 passed |
| Offline and configured static Playwright checks | 2/2 passed |
| Static DOM and standalone production browser checks | Passed; no backend required, GET-only checks passed |
| Electrum/browser keeper and native wallet workers | 18/18 covered: 17 passed in the full sweep; corrected manual-queue test passed separately |
| Root and frontend TypeScript checks; final production build | Passed |
| Existing opt-in development launcher lifecycle | Passed all startup/shutdown/recovery/ownership/port-conflict checks |
| Legacy source and compiled artifacts | All 24 checked files unchanged against `27b621b` |

The initial `npm test` sweep had 33 passes and two failures: a clean relay peer
exceeded the old startup deadline, and the new maximum-bound fixture funded three
periods while configuring sixteen. Both were corrected and rerun. The allocation
rerun also exposed a pre-existing wall-clock maturity assumption; both regtest
clocks are now controlled deterministically, with relay scheduling ticks and clock
reset in cleanup. All maturity, signature, accounting and relay assertions remain.

Browser checks ran sequentially after resource-heavy BCHN checks. Initial overlapping
runs are not passing evidence. A legacy manual-processing browser test paused server
responses before an initially disabled refresh button could be clicked. Its gate
now activates on the actual refresh message, retaining the original queueing and
confirmation assertions. Static navigation assertions now account for the separate
v2 entry. No contract or application security assertion was removed for these fixes.

## Asset matrix

Every row passed genesis, two or more registrations, exact ties, activation,
snapshot-preserving cancellation, three wins, immediate rewards, separate
allocations, remainder refunds, owner-authorized withdrawals, duplicate rejection,
and block invalidation/reconsideration. The token-to-BCH case also registered all
sixteen offers under BCHN standard policy. Native browser worker tests exercised
all five rows through the production worker, two-provider WSS fixtures, durable
IndexedDB plans, local wallet signatures and withdrawals during an active period.

| Staking asset | Reward asset | BCHN | Native browser worker |
|---|---|---|---|
| Fungible token A | BCH | Passed | Passed |
| BCH | Fungible token B | Passed | Passed |
| Fungible token A | Fungible token B | Passed | Passed |
| BCH | BCH | Passed | Passed |
| Fungible token A | Fungible token A | Passed | Passed |

Negative cases include underfunded genesis reserves, later tied winners, active
refunds, wrong token categories, missing token rewards, burns, unintended minting,
wrong native principal/carrier values, diverted escrow/rewards/state carriers,
wrong sponsor fees, swapped roles, duplicate spends and invalid withdrawal
signatures. Equivalent *genuinely funded* escrow and reserve donations are rejected
as replacement inputs, with their correct role index and regenerated valid sponsor
signature; the parent binding is independently exercised. Exact protected balances
are checked after each accepted transition. Portable tests cover missing
acknowledgements, persistence failure, competing registrations, provider errors,
provider disagreement, pending state, reorganizations and identical-byte recovery.

## Resource and policy evidence

At all configured amount/period bounds with sixteen eligible offers:

- Registry redeem script: 3,122 bytes; genesis redeem script: 5,226 bytes.
- Measured settlement fixture: 5,538 transaction bytes.
- Registry VM operation cost: 1,321,062 / 3,852,800 (about 34.3%).
- Registry hash iterations: 117 / 2,408.
- Largest accepted transaction in the five-pair BCHN run: 5,723 bytes.
- BCHN standard relay policy was enabled (`acceptnonstdtxn=0`).

The SDK resource fixture supplies an unused 65-byte authorization for permissionless
branches because its debugger cannot resolve an empty signature template. Normal
wallet keeper templates use an empty authorization and are verified separately.
The measurements describe the bounded fixture, not arbitrary padded witnesses.
The new family was checked with BCHN mempool policy and confirmation; independent
loopback P2P relay evidence is retained for the unchanged legacy family.

Raw evidence:

- [BCHN asset matrix and executable body fingerprints](generalized-assets-v2-results.json)
- [Maximum-bound VM metrics](generalized-assets-v2-max-resources.json)
- [Legacy allocation/relay regression evidence](generalized-assets-v2-legacy-regression.json)
- [Legacy source/artifact comparison](generalized-assets-v2-compatibility.json)

## Reproduction and remaining gates

Start the local regtest node with `npm run node:start`, then run `npm run test:v2`.
`npm test` compiles and runs both families; local chipnet mocks can also be run
separately with `npm run test:chipnet:local`. Run frontend and browser commands
sequentially on this VM. `npm run test:dev` additionally requires ports 18443,
3100 and 5173 to be free and a saved regtest checkpoint synchronized to the tip.
The lifecycle test did not mine or alter its saved config/checkpoint; the node was
restored afterward. The optional `ARENA_RELAY_CACHE=1` test flag reuses an independently
validated secondary node at `.regtest/relay-policy`; the default uses a clean peer.
Neither mode shares the primary node's chainstate or wallet database.

Before public rollout, independently audit the new covenants and transaction
builders and exercise actual WizardConnect wallets and public chipnet providers.
Local simulated-wallet signatures are not evidence that a particular wallet
supports contract signing. See [architecture and explicit limitations](generalized-assets-v2.md)
for NFT introspection, fixed fees, bounded amounts, light-client trust, unrecoverable
noncanonical donations and the absence of a creator unused-reward refund.
