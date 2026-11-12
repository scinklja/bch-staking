# Browser vault discovery recovery — 2026-11-12

Production: https://scinklja.github.io/staking-arena-site/

## Findings and reproduction

The actual confirmed genesis is `599bf07357f64c2b2dbf36c666fdf0655c1fc7bb38feb89c90a16517166853fc`. Its **canonical state category** is its funding/pregenesis transaction ID, `d5920d56cac5f28bb44f7882a95c9b96174507594862d8ea0b782304ff0a1f04`; these identifiers must not be interchanged. Confirmed height: **332026**, block `00000000000015d58ed55eef975010b7eefee2d1820c123d4149a0ddc2b758a3`. Terms decoded from the factory authorization and independently verified against the canonical factory/genesis on two public chipnet providers: staking category `e27140c714ca01e0143c4a5d42a20dcbd356e68846b8321d680535b91219921a`, epoch `1794496500`, 2 periods, 300 seconds, cap 1,000 satoshis. See [chain verification](vault-discovery-chain-verification.json).

A fresh session using the unmodified published build could reconstruct this vault after verified import. Thus a malformed genesis, wrong canonical category, missing configured-vault merge, or an inherent inability to replay this vault was **not** reproduced. The user's original browser did not provide the low-level resource/crash trace, so its exact underlying startup trigger cannot be retrospectively established.

The production failure path was reproduced with the **real vault and unmodified published build**, while making the replacement worker asset return HTTP 404 during import. Canonical import succeeded and persisted; the replacement worker emitted a plain `error` Event without message/filename. The UI then showed the exact combination **`Browser indexer worker failed: undefined`**, **Historical snapshot**, and **Vault not found**. See [controlled resource-failure reproduction](vault-discovery-resource-reproduction.json). This is fault injection into resource delivery, not a claim that the original user's failure was proven to be a 404.

Three confirmed software defects explain why startup failures became a persistent false absence:

1. The worker's static module graph (including asynchronous libauth/WASM initialization) loaded before its reporting code could execute. The parent assumed every worker error was an ErrorEvent with `message`.
2. A failed worker remained the Refresh target. Refresh sent another message to the failed worker instead of constructing a replacement. There was no bounded recovery.
3. The missing-vault page treated absence in an incomplete/historical response as definitive after indexing failed.

Imports already dispatch the catalog event, and `browserConfig()` already merges configured and locally verified genesis records. Reproduction confirmed that the replacement receives all three configurations, including this vault. The correction retains that behavior, verifies it in tests, and prevents obsolete-worker packets or incomplete fresh packets from presenting the previous catalog as current.

## Correction

- A small bootstrap with **no runtime imports** installs error, unhandled rejection and message-deserialization reporting before dynamically importing the indexer and WASM dependencies.
- Diagnostics retain message, filename, line/column and stack when supplied, startup phase, and a same-origin HEAD resource probe with HTTP status/content type or fetch failure. Plain Events get an actionable fallback instead of `undefined`; an `arena-indexer-diagnostic` event exposes the structured details.
- Readiness has a 30-second deadline. Fatal startup/runtime failures terminate the unusable worker and retry at most three launches with 1/2-second backoff. Refresh after exhaustion creates a new worker. Every launch re-reads the complete current vault configuration. Stale callbacks and outstanding diagnostic probes are ignored after replacement/unmount.
- Previous data stays historical while a changed catalog initializes. A fresh synchronized response must contain every configured genesis. Failed, stale or pending indexing displays an unavailable/loading view rather than a definitive missing vault.
- Detail routes accept a confirmed genesis ID as an alias while retaining the canonical category for vault identity, sharing and wallet network boundaries.
- Deployment retains the previous release's compiled hashed assets, so already-open pages can continue loading them. Existing rollback branches are preserved.

No wallet journals, settlement intents, local vault catalogs, recovery records or IndexedDB checkpoints are cleared or migrated. Checkpoint replay remains proof-verified; corrupt/mismatched cached state is rebuilt in memory under the existing behavior, without deleting durable records. Fingerprint-based Web Locks/BroadcastChannel coordination is unchanged. No history, transaction, byte, freshness, proof, chain-identity or mainnet restrictions were weakened. No resource exhaustion was deliberately induced; WASM/resource error reporting and bounded recovery are covered by regression tests.

## Validation

- **45 frontend tests passed** against the isolated release baseline. New coverage includes complete catalog configuration after creation/import notifications, cross-tab storage events, remount/reload discovery, obsolete-worker isolation, bounded worker restart/backoff, plain Event diagnostics, source/stack diagnostics, explicit Refresh recovery, stale missing-vault handling and genesis/category routing.
- Frontend type checks and the Pages production build passed. Vite retains the existing large-bundle advisory. Covenant sources and bytecode are unchanged.
- The final compiled candidate recovered automatically from a forced worker module HTTP 404, captured its resource URL/status/stack, rebuilt with all three configurations, and displayed the real vault. Both the old catalog checkpoint and the new catalog checkpoint remained present. See [live worker recovery](vault-discovery-recovery-live.json).
- Live candidate verification passed import, reload, a second tab following the indexing leader, outage retention, public Electrum reconnection, and genesis-ID alias routing. Both old/new configuration checkpoints and the catalog survived. See [candidate verification](vault-discovery-candidate-live.json). The local regtest BCHN process was stopped for the final checks; no BCHN chipnet RPC/API was used. Static asset requests and public Electrum were the only application data sources. No create/offer/processing/signing controls were clicked and no new transactions were broadcast.

## Release scope

The compiled release uses an isolated worktree based on the published wallet-scan correction (`release/wallet-scan-fix-2026-11-12`). Unpublished generalized asset changes in the main workspace are excluded. Runtime release source: `7b65a9b94ba8e7916fc7c123c624372242386ebf`.

Only compiled HTML/JS/CSS/SVG and `.nojekyll` are published. No source maps, source trees, profiles or credentials are uploaded. The wallet worker is byte-for-byte unchanged from the previous deployed wallet-scan fix.

Previous production and immediate rollback target: `b421663ce72e4155f02924746da452dcce1cf3bc`. Preserved public branch: `rollback/pre-vault-discovery-fix-2026-11-12`. Older rollback branches remain unchanged. Restore that branch's complete compiled tree onto main and commit/push to roll back without rewriting history.

## Published release

Compiled production commit: **`552000382d2a99c2f863efe6802f0fe44d57b956`**. GitHub Pages reported this commit **built** with no error. All eight candidate files matched their served SHA-256 hashes; all five previously published hashed assets remained HTTP 200. See [delivery receipt](vault-discovery-deployment.json) and [release manifest](vault-discovery-release-manifest.json).

The previous release remains on `rollback/pre-vault-discovery-fix-2026-11-12` at `b421663ce72e4155f02924746da452dcce1cf3bc`; existing older rollback branches are retained. A reload loads the corrected application without changing browser storage.

At **15:16:17 UTC**, the **published GitHub Pages origin** completed a fresh verified import and displayed the actual vault with **2 periods of 300 seconds, cap 1,000 satoshis**, under category `d5920d56cac5f28bb44f7882a95c9b96174507594862d8ea0b782304ff0a1f04`. The indexer was **Synchronized**, connected and non-stale, with all three configured categories and 13 verified transactions. There were **no worker errors or broadcasts**. The public verification asserted local BCHN/API ports 18443, 48332 and 3100 were all closed. See [published live verification](vault-discovery-published-live.json).

The local regtest BCHN process was restored after the public checks. No chipnet or mainnet BCHN/API server was started or used for verification. Browser wallet/settlement journals and recovery data were never reset.
