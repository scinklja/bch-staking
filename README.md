# BCH regtest development environment

The read-only React frontend is developed on `feature/frontend`. See [local startup, units, API proxy, testing and frontend limitations](docs/frontend.md). Run `mise exec -- npm --prefix frontend ci` followed by `mise exec -- npm run frontend` with BCHN running; open http://127.0.0.1:5173.

Staking Arena v0.3.0 backend development is on `feature/keeper-indexer`: see [keeper/indexer architecture, operation and limitations](docs/keeper-indexer.md). The read-only API and automated keeper are regtest-only; the v0.2.0 covenants are unchanged. The independent adversarial review remains deferred; the frontend is a separate read-only development branch.

Verified on Omarchy / Arch Linux, x86_64. This project includes the original infrastructure example and a bounded staking architecture experiment. Read [the architecture and limitations](docs/staking-architecture.md) before using the prototype. It is not a production staking platform. The [cancellation deadline investigation](docs/cancellation-deadlines.md) includes a BCHN-mined counterexample to UTC upper-bound cancellation checks and an irrevocable period-state experiment.

The [16-offer authenticated registry](docs/registry.md) adds protocol-assigned sequence numbers, UTC-gated immutable activation snapshots, fixed UTC reward periods, upfront S×W CashToken escrow, independent per-win allocations and maturity, future-only cancellation, full-roster ranking and collateral accounting. Offer eligibility freezes at actual on-chain activation; delayed execution does not shift the UTC schedule. Each win atomically pays its BCH reward and creates a token-funded allocation withdrawable by its owner independently of all registry phases. It remains a regtest experiment with documented genesis, asset and withdrawal limitations.

## Restart after VM boot

```bash
cd ~/bch-staking
mise exec -- npm run node:start
mise exec -- npm test
```

Start is idempotent, creates/loads the isolated `dev` wallet and mines up to height 101 on first use. No service is enabled at boot. Stop gracefully before shutting down the VM:

```bash
mise exec -- npm run node:stop
```

## Commands

```bash
mise exec -- npm run node:status
mise exec -- npm run mine -- 10
mise exec -- npm run compile
mise exec -- npm run compile:registry
mise exec -- npm run typecheck
mise exec -- npm test
bash scripts/node.sh rpc getbalance
bash scripts/node.sh rpc getrawtransaction TRANSACTION_ID true
```

Tests consume test BCH and append local blocks each run. The period, allocation and legacy registry tests wait on actual UTC boundaries without changing the node clock; allow several minutes for the full suite. They require the node to be running. Do not run multiple integration tests or scans concurrently.

## Files and installation

- `contracts/`: current Registry, StakePool and per-win StakeAllocation covenants, plus retained legacy experiments.
- `src/`: cookie-authenticated JSON-RPC client and CashScript `NetworkProvider` implementation.
- `tests/`: actual BCHN lifecycle, full-roster ranking, token escrow, independent allocations, snapshots, reserves, maturity and replay tests.
- `scripts/`: node lifecycle, mining and verified BCHN installation.
- `artifacts/`: compiler output.
- `docs/`: verification evidence, setup report and latest transaction IDs.
- `.regtest/`: private local node data, wallet and cookie; excluded from Git, directory mode 700.
- `downloads/`: downloaded archive and isolated public GPG keyring, excluded from Git.
- `~/.local/opt/bchn-29.2.0/bin/`: installed binaries; `~/.local/bin/` contains links.

Existing Git and mise were retained. Node 24.22.2 was installed with `mise use node@24`; `mise.toml` pins the project version without changing the global Node version. npm dependencies are recorded in `package-lock.json`.

Reinstall dependencies with `mise install && mise exec -- npm ci`. On another Arch machine without Git/mise/GnuPG/curl/ripgrep, install these through Arch packages first (`sudo pacman -S --needed git mise gnupg curl ripgrep`), after a normal full system upgrade. No system packages were removed during this setup.

Install BCHN with `bash scripts/install-bchn.sh`. The installer downloads the official 29.2.0 binary and clear-signed checksum manifest, imports the pinned upstream signer fingerprint, checks the GPG signature and fingerprint, then checks SHA-256 **before** extracting or installing. The initial installation used the same archive and manifest from the official download server's `releases/latest/` directory. Evidence is in `docs/signature-verification.txt` and `docs/checksum-verification.txt`.

Signer fingerprint: `D465135F97D0047E18E99DC321810A542031C02C`, published in the official tagged source's `contrib/gitian-signing/keys.txt`. GPG reports unknown owner trust because no personal web-of-trust certification was made; the signature is cryptographically valid and the fingerprint matches upstream. Trust originates in the official HTTPS sources, not an independent out-of-band identity check.

Sources:
- https://github.com/bitcoin-cash-node/bitcoin-cash-node/releases/tag/v29.2.0
- https://docs.bitcoincashnode.org/doc/index.html
- https://raw.githubusercontent.com/bitcoin-cash-node/bitcoin-cash-node/v29.2.0/contrib/gitian-signing/keys.txt
- CashScript provider interface and Electrum implementation inspected in installed `node_modules/cashscript/dist/network/` (0.14.0).

## Isolation and provider design

Every CLI invocation explicitly selects this project's data directory and regtest. `connect=0`, `listen=0`, `dnsseed=0`, `discover=0`, UPnP/NAT-PMP disabled prevent automatic peers or inbound P2P connections. RPC binds IPv4 localhost only and uses BCHN's generated cookie; no fixed password is stored. Startup also calls `setnetworkactive false` to disable P2P processing. No public blockchain or preexisting wallet was opened. Keep this configuration private to regtest.

The standard CashScript Electrum provider speaks the Electrum protocol, not BCHN JSON-RPC, and does not supply a default regtest endpoint in 0.14.0. This project implements the SDK interface directly over local RPC, checking the chain is regtest. It uses `scantxoutset` with raw locking scripts, merges matching mempool outputs and filters spent outputs with `gettxout`. `txindex=1` enables raw transaction retrieval after confirmation. There is no Electrum service to start.

This adapter suits a small private chain: scans are not an address index, must not overlap, and do not offer Electrum subscriptions. It explicitly rejects CashToken UTXOs; extend token handling and tests before developing token contracts. Scan/mempool queries are not an atomic snapshot. Use a serial development workflow. Coinbase maturity filtering is not provided for arbitrary mining-address queries; contract funding in this example uses mature wallet funds.

## Troubleshooting

- Use `mise exec --` to avoid the globally configured Node 26.
- Startup logs: `.regtest/regtest/debug.log`. An RPC connection error usually means `npm run node:start` is needed.
- BCHN 29.2.0 does not accept `-daemonwait` or the `networkactive` config option. Start uses `-daemon` plus a bounded readiness poll. `connect=0` must be inside `[regtest]`.
- TypeScript 7 needs explicit `types: ["node"]` in this project; Node type definitions match Node 24.
- RPC port 18443 must be free. Inspect with `ss -lntp`; do not terminate unrelated processes.
- Insufficient funds: `npm run mine -- 101` creates mature regtest funds.
- Scan already in progress: wait for the other test/scan to finish.
- npm may report esbuild's install script as pending approval. The installed platform binary was sufficient and tsx was executed successfully; no blanket install-script approval was enabled.
- Never delete `.regtest` while the node is running. Deleting it discards this environment's test chain and wallet.

## Independent static website hosting

Staking Arena can be served from Cloudflare Pages while this VM is shut down. See [Cloudflare setup and deployment steps](docs/cloudflare-pages.md) for GitHub build settings, `VITE_API_BASE_URL`, explicit offline/last-known confirmed snapshot behavior, account configuration and backend-free verification. The production default makes no API requests. Nothing has been published; local development and VM port forwarding remain available.
