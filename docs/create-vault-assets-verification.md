# Unified Create Vault asset selection

Implemented on `dev/generalized-assets-v2-implementation`. `#/create` now owns
both asset selectors in one form. `#/v2` retains import, verification and recovery.
No covenant source, bytecode, protocol rule or wallet transaction builder changed.

| Staking → reward | Existing builder coverage | Unified public-wallet creation |
|---|---|---|
| CashToken → BCH | v1 and v2, local BCHN / simulated wallets | Existing experimental v1 flow; explicit wallet authorization |
| BCH → BCH | v2, local BCHN / simulated wallets | Experimental v2 preview; creation unavailable |
| BCH → CashToken | v2, local BCHN / simulated wallets | Experimental v2 preview; creation unavailable |
| CashToken → CashToken | v2, including identical categories, local BCHN / simulated wallets | Experimental v2 preview; creation unavailable |

All four pairs have complete existing local transaction construction. None is
newly claimed as verified with a real WizardConnect/Cashonize wallet. The v2
public-wallet creation gate is intentional: the existing review requires actual
wallet signing and recovery compatibility before rollout, and this task excludes
live verification. The browser client rejects new v2 creation before requesting a
signature. Existing funded factories and signed operations remain recoverable.
No selection silently uses a BCH-only covenant.

BCH input is parsed with string/BigInt arithmetic and displayed in BCH; tokens use
integer fungible units without inferred metadata decimals. The form rejects invalid
or reserved all-zero categories. Confirmed wallet scans populate category
suggestions; manual entry is supported. V1 still requires a confirmed fungible
UTXO proving the staking category, but consumes no staking tokens during creation.

Funding previews distinguish the full reward reserve, carrier outputs, miner fees,
wallet change allowance, future sponsorship and total wallet balances. V1 uses
`vaultFunding`; v2 previews reflect the existing fixed preparation/genesis layout.
V2's conservative BCH allowance includes possible token change; selected token
input carriers may contribute. Reward token shortages, BCH shortages, absent v1
category proof, missing scans and invalid terms block review. Selected UTXOs and
signed transaction bytes are still checked by the existing wallet implementation
before authorization/submission. An edit clears the funding acknowledgement.

The marketplace shows actual v2 assets from local verified imports and recovery
records. V2 genesis/detail links use `#/v2/vault/<genesis>` and require explicit
canonical refresh. Journal-based confirmed/pending observations are historical,
not assertions of current chain state. Offer records cannot relabel a confirmed
genesis as unconfirmed. V1 catalogs, snapshots, transaction visibility and recovery
records retain their existing formats, including the older API creation record.

## Automated verification

All verification uses local BCHN regtest, local VM fixtures, loopback WSS or
intercepted browser data. No live chipnet verification or broadcasts were performed.

| Check | Result |
|---|---|
| `ARENA_RELAY_CACHE=1 npm test` | 53 regtest cases and 3 local VM/network-mock cases passed |
| Genuine v2 BCHN matrix within that run | 99 accepted transactions; 130 rejected attacks; all four pairs and identical-category tokens |
| `npm --prefix frontend test` | 67 passed across 18 files |
| Root/frontend TypeScript | Passed |
| Development browser regressions on isolated port 5183 | 6 distinct cases passed; 5 in first run, corrected reserve-row locator passed separately |
| `npm --prefix frontend run test:static` | 2 passed; offline and API production builds |
| `test:static:dom` and `test:static:browser` | Passed; navigation, mobile layout, outage/recovery and GET-only checks |
| `npm --prefix frontend run test:electrum` | 19 passed; v1/v2 wallet workers, sponsorship, recovery, discovery, indexing, pending thresholds, reorgs and IndexedDB failures |
| Compiled Pages release | Build, TypeScript and `test:create:pages` passed; all four pairs, 44px touch targets, unclipped funding values and local v2 discovery |

Earlier frontend failures were test locator issues: a datalist changes the category
input's accessible role to combobox; identical BCH values must be scoped to the
reward-reserve row; jest-dom `toHaveValue` does not accept an asymmetric string
matcher. The compiled-release test also required an explicit combobox role locator. Assertions were corrected without weakening funding or authorization
checks. The release check identified native select targets below 44px; an explicit minimum height fixes touch usability. One targeted test command initially ran from the repository root rather
than `frontend`, omitting jsdom setup; the correctly configured run passed.

The production mobile check intercepts sockets and replaces worker provider
endpoints with loopback addresses. It verifies every pair, actual touch targets,
exact reserves, no clipped funding values, v2 listing/detail links and disabled
creation approvals. Published assets are subsequently verified by HTTP GET and
SHA-256 only; the public site is not executed against live providers.

## Remaining real-wallet gates

Real WizardConnect/Cashonize funding, exact token change, Schnorr ALL|UTXOS covenant
signing, two-stage creation/recovery, provider disagreement and public-chain
reorganization behavior still require verification with explicit authorization.
The independent covenant/security review described in the existing v2 design also
remains a rollout gate. This change deploys frontend assets only. Mainnet remains
disabled, and no new covenant is deployed.

## Delivery state

Implementation commit: `7f2b6d4`. Compiled frontend commit:
`01c9bb8209724d176671af48f1a24bdb95bb2e9f` is deployed to
https://scinklja.github.io/staking-arena-site/. GitHub Pages reported the build
complete on 2026-11-13 at 10:28:33 UTC. All 21 compiled files were retrieved by
HTTP GET and matched their tested SHA-256 hashes. The public frontend was not
executed against live providers. The earlier authentication blocker was resolved
using the existing CLI credential after the desktop keyring was unlocked.

The previous public release is
`1d361a8d9418886e689d781aa001b3f2567aab3f`, retained in the verified complete
`.pages-release/pre-unified-create-2026-11-13.bundle` and published branch
`rollback/pre-unified-create-2026-11-13`. Publication atomically advanced `main`
and created that rollback branch. The release retains all 30 previous hashed
assets unchanged; the previous entry script was also fetched and hash-verified.
Asset hashes, test counts and deployment evidence are recorded in
[the deployment manifest](create-vault-assets-deployment.json).

To roll back while preserving assets used by already-open tabs, restore just the
previous entrypoint in the deployment checkout, then publish a new commit:

```sh
git -C .pages-release/public restore --source=rollback/pre-unified-create-2026-11-13 -- index.html
git -C .pages-release/public commit -m "Restore previous Pages entrypoint"
git -C .pages-release/public push origin main
```

These rollback commands are documented for recovery and were not executed.
