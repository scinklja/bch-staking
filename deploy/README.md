# Independent hosting — prepared, not deployed

No hosting account/server is currently connected. This package has not been deployed, its container build has not been run (Docker is unavailable here), and the GitHub Pages site has not been pointed at a new API. The earlier chipnet transaction evidence used the Omarchy backend and does not establish VM-independent operation.

The public GET API remains read-only. Separate POST endpoints prepare unsigned requests and relay wallet-signed transactions or permissionless covenant spends. They never sign with a user's keys. Hosted mode disables spending-key RPC methods and rejects `ARENA_SPONSOR_KEY`; BCHN must run with `disablewallet=1`. The keeper spends only permissionless covenant paths funded from vault reserves.

## Concrete VPS deployment

Use a continuously running Linux host with persistent storage, inbound HTTPS and a DNS name. `compose.yaml` uses Linux host networking so BCHN RPC remains loopback-only. It is a VPS layout, not a ready-made multi-service Railway blueprint. Railway deployment requires equivalent persistent volumes and colocating wallet-disabled BCHN with the API, or another reviewed private-node connection design.

1. Install a verified BCHN release supporting the current and upcoming chipnet consensus rules. The VM's 29.2 release reports expiry on November 15, 2026; do not bypass expiry. Install its `bitcoind` as `/usr/local/bin/bitcoind`.
2. Run BCHN as a dedicated unprivileged `arena` account. Create `/var/lib/arena-bchn` mode 700, install `bchn-chipnet.conf` there as `bitcoin.conf`, and install the supplied service template. Enable/start it on the independent host. Wait for synchronization and transaction indexing.
3. From the repository root, create `deploy/data` owned by container UID 1000; copy `config.example.json` to `deploy/data/config.json`. Copy only PUBLIC vault parameters/genesis IDs from `docs/chipnet-e2e-verification.json` if indexing the verified vault. Do not copy `.chipnet`, `.regtest`, wallets, browser profiles, seeds, or private keys.
4. Provide the API container read access to BCHN's cookie using matching dedicated UID or a narrow ACL. Never make the cookie world-readable. Set `BCHN_CHIPNET_DIR=/var/lib/arena-bchn/chipnet` and `ARENA_API_DOMAIN` to the actual API DNS name. Configure DNS and permit ports 80/443. RPC 48332 and API 3100 stay private.
5. Run `docker compose -f deploy/compose.yaml up -d --build`. Caddy terminates HTTPS. Check `/health` reports `chipnet`, connected=true, a current tip and a recent health timestamp. Then verify `/vaults` and exact-origin CORS using the actual Pages Origin, without its repository path.
6. Back up `deploy/data` (config, checkpoint, broadcast journal) and Caddy certificate storage. Configure independent uptime alerts and host/BCHN supervision. A single host with restart policies is not redundant high availability. Initial sync/outages stop signing/submission readiness; the frontend labels stale snapshots.

Keep one indexer writer/keeper per checkpoint. Plans currently expire in memory after ten minutes and are lost across restarts; the browser must rebuild them. Rate limiting, bounded admission and concurrent intent/load testing must be reviewed before unrestricted public traffic; the existing local intent service is not claimed to be production hardened.

## Pages publication

The added `pages.yml` workflow takes the actual independent HTTPS API URL, validates its chipnet health, builds with `VITE_API_BASE_URL`, and publishes the existing frontend using GitHub Pages Actions. GitHub Pages must be configured for Actions and the repository connection must allow publication. Do not supply the Omarchy VM URL, a placeholder domain, RPC endpoint, or cookie.

The API permits the configured `ARENA_UI_ORIGIN` exactly (comma-separated origins supported), including JSON/custom-header preflight for wallet intent requests. The VPS template uses `https://scinklja.github.io`; confirm the actual Pages site before deployment. No CORS wildcard or RPC forwarding is used.

## Acceptance gate still outstanding

After hosting access is connected: deploy/verify remote BCHN and HTTPS API, publish Pages with its real URL, and test from an ordinary isolated browser with all `localhost`, VM hosts and private-network endpoints blocked. Confirm a fresh public-wallet Create Vault, offer, keeper activation/settlement/reward and independent withdrawal on chipnet; record txids and confirmation blocks separately from simulations. Exercise API outage, stale data, wallet switching/disconnection and real chain reorg reconciliation. Verify hosted configuration contains no spending keys. Prior VM-based evidence cannot substitute for this gate.

The frontend now polls read-only `/transactions/TXID` status and retains transaction IDs locally across refreshes. It distinguishes confirmations, pending transactions, unobserved/reorganized transactions and API unavailability. The existing ranking/allocation projection remains confirmed-only; ready-but-unsettled periods are exposed in the vault data. This is preparation, not evidence of a completed ordinary-browser hosted journey.

Railway's volume requirements must be checked when selecting that route: https://docs.railway.com/volumes . Persistent storage and a continuously running paid service must be configured explicitly; a suggested connection alone provisions nothing.
