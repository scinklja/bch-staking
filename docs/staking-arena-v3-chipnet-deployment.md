# V3 chipnet deployment

This deployment extends the reviewed v3 implementation at `5777a9995d3e8ffee6c7339f8abb950192f5b453`. It preserves all covenant artifacts, their bytecode, the 16-slot queue, continuous registration, ranking and tie-breaking, immutable releases, accumulated virtual buffer, no-skipping behavior, repeated wins and independent relative locks.

## Network and wallet boundary

The public build explicitly selects `VITE_INDEXER_MODE=electrum VITE_V3_NETWORK=chipnet`. The v3 protocol, wallet and indexer accept only chipnet or explicitly selected local regtest. Mainnet and generic testnet providers are rejected. Wallet addresses use the selected chain's prefix. Every Electrum session verifies genesis and (on chipnet) fork checkpoint 121957; two distinct hosts must agree. Existing canonical raw transaction, inclusion proof, header linkage, current-source and full replay/reorganization checks remain intact. Chipnet uses the normal six-hour tip freshness limit; the relaxed development limit applies only to explicitly selected regtest builds.

Chipnet operation journals, legacy claim journals, saved vault configurations and Web Locks have separate names. Existing regtest journal names remain available to local builds. Raw transaction caches are scoped to each verified Electrum session; the v3 indexer does not trust persisted chain snapshots.

Cashonize uses the existing WizardConnect live session boundary. Mainnet keys, explicit conflicting test-chain declarations, changed keys, disconnected/reconnecting sessions and invalid identities are rejected. hdwalletv1's testnet public-key family does **not** attest the precise test chain. Current Cashonize omits the optional application-specific chain declaration. Compatibility therefore relies on pinned chipnet Electrum identity and confirmed chipnet source verification immediately before each approval and submission, with repeated live-session checks. A wallet that declares another network is rejected. This protocol limitation remains visible in the connection UI.

Every public signing request uses `broadcast:false`; the worker and signing client explicitly reject any saved/authorized v3 request that enables wallet broadcasting. WizardConnect correlates response action/sequence; the application rechecks session identity and validates signed transaction bytes, source metadata, signatures, covenant execution, exact outputs, tokens and fees. Signed bytes are journaled before application broadcast.

## Accessible operations

At `#/v3`, users can create BCH/BCH, BCH/CashToken, CashToken/BCH and CashToken/CashToken vaults; register continuous offers with S×W collateral; cancel and recover unused collateral; claim the highest-ranked reward using caller-owned confirmed token-free BCH; and withdraw independent allocations after consensus maturity. Claim fees remain exactly 10,000 satoshis plus token carriers. Caller change is preserved, the caller may differ from the winning staker, and no FeeSponsorV3 donation is required for new claims.

Creation and other funded actions retain funding confirmation followed by a second explicit covenant approval. Claims use one atomic wallet approval. Journals expose reconciliation, interrupted approvals, exact-byte retries and public recovery configurations. Confirmed creations populate the browser's saved-vault list after reconciliation and can be verified/opened after reload. Discovery is browser-local/imported configuration, not a globally complete public directory. Share the public configuration with another browser; never share wallet secrets.

The first reward release occurs after MTP exceeds schedule start plus one interval. The UI displays full reward reserve, creation BCH funding (20,000 in fees plus 3,000 covenant carriers), token-change carriers, collateral, effective 512-second locks, reserve, buffer, next release, ranked queue and claim availability. V1/v2 routes and their existing asset behavior remain available. V3 is experimental, uses chipnet test funds only, and is not described as audited or production-ready.

## Verification and limits

Focused chipnet tests run against deterministic synthetic linked headers and transaction proofs, with real v3 BCH2026 VM/signature validation. They cover all four asset pairs through creation, offers, caller claims/change, cancellation/refund and mature withdrawal, and reject premature withdrawal, excess reserve requests, mainnet providers and wallet-broadcasting metadata. These are local integration tests, not live chipnet transactions or proof of public Cashonize signing compatibility.

The browser WSS fixture tests cover worker startup, two-host verification, pending claims/reload, provider failure and reorganization replay. The existing portable Electrum regression suite covers chipnet identity, malformed proofs, stale tips, recovery and v1 lineage. Frontend tests cover signing/rejection/recovery, configuration guards and live wallet-network checks. Production typechecking, build, compiled-asset inspection and read-only public Electrum checks supplement those tests. Release-specific results and deployed/source hashes are recorded in the adjacent deployment JSON.

No funded chipnet transaction, wallet connection, vault, offer or claim is initiated during deployment. The first real Cashonize funded test belongs to the user. Browser permission dialogs, actual Cashonize covenant signing support, device-specific behavior and real transaction relay/confirmation remain unverified until that test.

## Publication and rollback

Only compiled static frontend files, stripped compiled covenant artifacts and a public release manifest are copied to `scinklja/staking-arena-site`. Source maps and private development files are excluded. Previously published hashed assets are retained so cached entry points can continue loading. The new index references content-hashed assets under relative paths for the repository prefix.

Pre-deployment public commit: `00d5baf50f43b5802f8caf2e5125398dd0bb470d`.
Rollback branch: `rollback/pre-v3-chipnet-2026-11-13` in `scinklja/staking-arena-site`.
Verified complete local bundle: `.pages-release/pre-v3-chipnet-2026-11-13.bundle`.
To roll back without rewriting public history, restore that branch's tree in a new commit on the published `main` branch and push it; GitHub Pages then republishes the prior compiled site.
