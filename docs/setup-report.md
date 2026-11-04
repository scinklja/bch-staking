# Setup report — 2026-11-04

Environment ready at `/home/omarchy/bch-staking`. No staking protocol implemented.

| Component | Installed version |
| --- | --- |
| Node.js (mise, project pinned) | 24.22.2 LTS |
| npm | 11.19.1 |
| Git | 2.56.0 |
| TypeScript | 7.0.2 |
| tsx | 4.23.15 |
| CashScript SDK / cashc | 0.14.0 / 0.14.0 |
| Node type definitions | 24.19.2 |
| Bitcoin Cash Node | 29.2.0-07576013c |

BCHN was selected from the official latest stable release and verified before installation using Calin Culianu's signed checksum manifest. The exact primary fingerprint matches the official tagged key list. Verification output is retained beside this report. See README for sources and the trust model.

Successful verification:

- Real node startup, readiness polling, graceful shutdown, restart and existing wallet reload.
- Initial generation of 101 regtest blocks and positive spendable wallet balance.
- Cookie-authenticated localhost JSON-RPC.
- Zero peers and only a localhost RPC listening socket, no P2P listening socket.
- Contract compilation with cashc and strict TypeScript checking.
- Contract funding of 100,000 satoshis and unconfirmed UTXO discovery.
- Confirmed UTXO discovery via BCHN RPC.
- Incorrect contract argument rejected by BCHN consensus/mempool validation.
- Correct contract argument broadcast through CashScript TransactionBuilder.
- Spent UTXO disappears even while spend is unconfirmed.
- Block generation and spending transaction confirmation.
- Shell syntax checks. npm dependency audit reported zero vulnerabilities.

`test-output.txt` contains executed test results; `latest-test-result.json` contains the latest funding/spending transaction IDs, height and spendable balance. Tests modify regtest state, so these numbers advance on each run. On the first successful test the chain reached height 103 with 149.99998771 test BCH spendable.

Node settings: dbcache 32 MB, mempool cap 16 MB, one script-verification thread, two RPC threads. Measured node RSS was approximately 94 MB. Although 3 GB was specified, the guest reports about 1.4 GB usable RAM; the environment passed under that actual allocation without changing VM or host settings.

No unresolved installation or integration failures. Deliberate scope limits: BCH-only RPC adapter, serialized small-chain scans, no Electrum subscriptions, no CashToken support, and no boot autostart. These are documented in README. Only project-local regtest wallet material was created; node state and cookies are excluded from Git.

Restart exactly:

```bash
cd ~/bch-staking
mise exec -- npm run node:start
mise exec -- npm test
```

Status: `mise exec -- npm run node:status`

Generate test funds: `mise exec -- npm run mine -- 101`

Stop: `mise exec -- npm run node:stop`

Installation and troubleshooting details, command reference and directory descriptions are in `../README.md`. Binaries live in `~/.local/opt/bchn-29.2.0/bin`, with links in `~/.local/bin`. The node is left running for development.
