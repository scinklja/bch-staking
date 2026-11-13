# Chipnet integration

Chipnet is the default integration environment. Mainnet is excluded. The original regtest files, tests, chain, wallet and milestone tags are retained. Reference tests require `ARENA_NETWORK=regtest` (set by the existing npm test commands); chipnet development never starts regtest.

## Current verification status

The [final live audit](chipnet-e2e-verification.json) verifies **10 confirmed project transactions**, including the complete Create Vault → Make an Offer → activation → settlement/reward → independent withdrawal lifecycle. The owner received a 1,000-satoshi BCH reward and recovered all 1,000 stake tokens in a single-input withdrawal, without a registry input. Total project fees were 51,000 satoshis. See `chipnet-verification.json` for the latest actual node observation. `npm run test:chipnet:local` uses synthetic transactions and mocked RPC responses with the BCH 2026 VM; it does **not** broadcast or confirm anything on chipnet. Its lifecycle includes wallet signature placeholders, factory funding, canonical genesis, exact S×W escrow preparation, offer authorization at registry input 0 and wallet funding input 2, activation, settlement, atomic BCH reward and token allocation, and independent mature owner withdrawal. It also rejects changed wallet outputs and chain/fork/IBD/relay mismatches.

The node also decoded an existing confirmed public-chain CashToken output, recorded in [chipnet-token-observation.json](chipnet-token-observation.json). That verifies token-aware chain/RPC data handling, not creation of this project’s test asset.

The existing [real WizardConnect wallet report](wizardconnect-verification.md) establishes Cashonize chipnet pairing and public key derivation. That report predates these transaction flows and does not certify their live wallet approval, signing, relay or confirmation. The [current live signing evidence](chipnet-wallet-verification.json) now verifies actual Cashonize approvals and BCHN acceptance for P2PKH funding, escrow preparation, and the registry covenant signature. The independent StakeAllocation owner signature has also been approved in Cashonize and accepted by BCHN. Frontend unit tests use mocked relay transport.

Faucet funding was received for the fresh node test wallet at `bchtest:qr47ssf5hcpjnf0f06g4nc875nf0tjxmfv86u4lxa2`. The [faucet](https://tbch.googol.cash) requires a human CAPTCHA and **chipnet** selection. A requested address is not proof of received funds. The actual finite test category is `48505b63bb3b4211c2d44099e1529d015a454e41c1f56aba7e12c87e5722c431`; token genesis and canonical funded vault genesis are confirmed in block 331819. The vault genesis is `128606824ed744a0f7f5ba45904bd87180cd0483df79b4fb54da125fcf75be74`. Offer, activation and settlement/reward confirmed in block 331820; independent withdrawal confirmed in block 331821. Subsequent confirmation counts are recorded in the current JSON reports.

## Startup and funding

```sh
npm run chipnet:start
npm run chipnet:status
# Initial wallet creation, once, if not already present:
bash scripts/chipnet-node.sh rpc createwallet arena-chipnet
# After confirmed faucet funding and complete synchronization:
npm run chipnet:provision
npm run dev
```

The node uses `.chipnet/bitcoin.conf`, chain subdirectory `.chipnet/chipnet`, and localhost RPC port 48332. Configuration template: `scripts/chipnet.conf`. BCHN calls its network `chip` and uses `[chip]` in bitcoin.conf. The wallet is `arena-chipnet`; the cookie never enters the browser. `BCH_RPC_URL`, `BCH_RPC_COOKIE`, `BCH_RPC_WALLET`, and `ARENA_NETWORK` configure the backend. Only a local HTTP cookie-authenticated RPC is accepted.

This checkout has an initialized chipnet node wallet and `.chipnet/frontend/config.json`. On a new checkout create that file with `{ "vaults": [], "checkpoint": ".chipnet/frontend/checkpoint.json", "port": 3100, "pollMs": 10000, "keeper": true }`. The directory is ignored by Git. The launcher supports an empty chipnet registry; it does not mine, provision tokens or create a vault automatically. The token provisioning command requires at least 500,000 available chipnet satoshis (unconfirmed funding is permitted and reported separately) and is resumable via `.chipnet/provision.json`. It creates a finite supply of 1,000,000,000 fungible test units with no minting NFT and prints the actual category and broadcast/confirmation status.

The frontend needs a funded chipnet HD wallet with WizardConnect support (the previously tested wallet is Cashonize). Backend faucet funds are held by the node test wallet, **not** the WizardConnect wallet. Transfer BCH and test tokens into the connected wallet's receive index 0 before using its outpoints in the forms. Do not import a wallet seed into Staking Arena. The minimal forms deliberately take explicit funding outpoints rather than adding wallet discovery infrastructure.

Create Vault requests a wallet-approved P2PKH transaction placing reward budget, state carrier and lifecycle fee reserve into factory output 0. The permissionless factory spend creates the canonical two-output genesis. The form reports its broadcast txid; after a real confirmation, “Admit confirmed genesis” verifies the factory provenance and persists the vault configuration. Pending public genesis terms are saved locally so a refresh can resume admission without funding another vault. The keeper then processes that confirmed registry.

Make an Offer requests two approvals: first split exactly S×W test tokens into a dedicated receive output, then sign the registry transition and escrow funding input. It preserves registry BCH reserves. Competing registry spends are rejected by mempool validation; rebuild the offer against the new confirmed state. Do not treat unconfirmed offers as registered. Independent withdrawal is available from a vault's allocation list after its chain MTP maturity and requires the allocation owner's signature. Activation and settlement use the existing keeper.

For a minimal real run choose one period, stake 1,000, duration 1, reward 1,000 satoshis, maximum wins 1. Fund and register **before** the first activation. Choose a UTC start far enough ahead to allow confirmations. Public chipnet blocks and median time past cannot be accelerated: activation, confirmation and withdrawal maturity require actual chain progress. Keep the epoch and period length fixed after funding.

## Signing and network checks

Every signing or send RPC checks configured chain name and genesis; chipnet additionally pins block 121957 (`0000000056087dee73fb66178ca70da89dfd0be098b1a63cf6fe93934cd04c78`). Chipnet and testnet4 share genesis, so genesis alone is insufficient. Writes also require IBD=false, blocks=headers, recent MTP and active peer connectivity. This is a readiness policy; transient header races can require retrying. Chipnet mining and mock time are refused.

The actual WizardConnect transaction path requires a live handshake, exclusively testnet-family HD public paths and a chipnet target. Mainnet-family, unknown, conflicting, changed or disconnected sessions are rejected before invoking the SDK. Explicit conflicting chain declarations are refused. Paths and selected target are checked again after preparation and after wallet approval. The backend resolves all source outpoints on the synchronized chipnet chain and verifies funding ownership against the receive public key; the wallet signs with SIGHASH_ALL|SIGHASH_UTXOS|SIGHASH_FORKID and `broadcast:false`. The backend compares the returned transaction to the prepared plan, allowing signature changes only, then checks readiness and mempool policy before broadcasting.

**Protocol limitation:** hdwalletv1 does not declare an authenticated exact test-network identity. A tpub does not prove the wallet is configured for chipnet. We bind each transaction to chipnet source outputs and reject mainnet key versions; the UI states this distinction. This does not certify arbitrary wallets, distinguish a dishonest wallet's self-reported network, or certify wallet operations beyond the live approvals recorded above. The older exact-chain declaration compatibility helper remains conservative for generic session display; transaction-specific checks use the source-output binding described above.

Transaction intents are local-only POST endpoints `/transactions/plan`, `/submit`, `/genesis`, `/admit`, proxied under `/api`. They require JSON, a chipnet custom header, and an allowed browser Origin; no cross-origin permission is granted. Default allowed origins are `http://127.0.0.1:5173` and `http://localhost:5173`; set `ARENA_UI_ORIGIN` for another explicitly trusted UI origin. Only in-memory plans survive for ten minutes; restarting the service invalidates them. There is no arbitrary RPC forwarding or wallet-private-key endpoint. Static hosting with a remote read-only API does not provide this local transaction service.

## Covenant compatibility and live evidence

No covenant source or compiled bytecode has been modified. State authentication, canonical factory genesis, full roster ranking, fixed UTC schedule, reserve coverage, frozen activation eligibility, S×W escrow, atomic BCH reward and per-win token allocation, owner authorization and independent stake maturity remain enforced by the existing scripts. Only provider/address network selection and surrounding transaction/service plumbing change. New vault funding includes extra reserve for existing fixed fees; no fee or maturity invariant was relaxed.

BCHN 29.2.0 reports chipnet software expiration on 2026-11-15 and recommends upgrading. Do not disable expiration as a substitute for a consensus-compatible upgrade. This is a material operational limit for work continuing beyond that date.

Current live evidence: [funding](chipnet-funding-verification.json), [node acceptance and confirmations](chipnet-verification.json), [independent relay observation](chipnet-relay-verification.json), and [real wallet signing](chipnet-wallet-verification.json). Offer registration, activation and settlement/reward are confirmed in block 331820. Independent withdrawal is wallet-approved and confirmed in block 331821. The [live mainnet rejection test](chipnet-mainnet-rejection.json) detected a genuine mainnet session and blocked transaction preparation before any signing dialog. Public-peer connection alone is not proof of transaction relay. Record these separately from VM tests, with txids, confirmation blocks and UTC observation time. Keep regtest evidence in its existing reports.


## Live verification runner

The regular service keeper is enabled in the saved chipnet configuration after the completed live run. The single test fixture is pinned in `.chipnet/e2e-config.json`; its keeper is initially disabled in the service configuration to prevent activation before the test offer confirms. `tsx scripts/chipnet-e2e-keeper.ts` normally waits for a confirmed nonempty roster, then runs the existing permissionless activation and settlement builders. For this minimal live run, `--pending-offer=TXID` explicitly pins the accepted offer proposal, verifies its direct canonical parent, complete state witness and token commitment against BCHN, and permits activation/settlement to follow it in the same relay package. This pending proposal is private to the test runner and never enters the confirmed indexer, API or checkpoint. It may relay settlement as a child of the accepted activation transaction in one package; this changes no covenant or confirmed indexer state. Both transactions remain pending until BCHN confirms them. The regular service keeper retains its confirmed-state stepping behavior. Once a confirmed winning allocation appears, use the connected owner wallet's withdrawal button.

`npm run chipnet:verify` audits all recorded project transactions, canonical lineage, reward, independent single-input withdrawal, finite token supply, final UTXOs and original milestone tags. `npm run chipnet:record` records separate pending and confirmed transactions from actual BCHN receipts. `npm run chipnet:relay` verifies the independent Electrum server's chipnet fork and the identical transaction bytes. `npm run chipnet:funding` rechecks the faucet receipt. `npm run chipnet:wait -- TXID` waits for an actual confirmation and retries transient header/synchronization races. These commands do not mine or alter chain time.


The recorded live run uses one period with a 60-second length and a UTC epoch already behind chain MTP. Its allocation maturity is therefore already satisfied when the delayed settlement executes, as the existing fixed-schedule protocol permits. No clock or maturity rule was changed. This verifies a real legally mature withdrawal and the delayed-execution path; a fresh future-start dwell-time test is not claimed.


The final independent sync/relay audit used `chipnet.imaginary.cash`, with an exact chipnet fork checkpoint and matching current tip. The prior observer (`chipnet.bch.ninja`) returned WebSocket connection failures during the final refresh; its earlier successful observations remain valid. The observer now defaults to the verified working endpoint and accepts `CHIPNET_ELECTRUM_HOST` for an explicit alternative. All ten project transactions were independently observed and locally confirmed. On a new private data directory, provisioning creates a fresh node-wallet faucet address (or uses `CHIPNET_FUNDING_ADDRESS`); it never reuses this run's published address automatically.
