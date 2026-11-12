# Mandatory browser period processing and scheduled offer admission — 2026-11-12

This release keeps the existing v1 covenants and mainnet restrictions unchanged. It corrects schedule presentation/admission and makes permissionless browser processing mandatory in the published chipnet frontend. It creates no new chipnet vaults or offers and never requests a wallet signature for period processing.

## Policy and UI

For confirmed period `p`, registration is allowed only while the confirmed state is open, capacity remains, data is fresh, and both UTC and verified chain MTP remain before `epoch + p × periodSeconds`. An overdue cursor must be processed before another window can reopen. Lifetime expiry is `epoch + periods × periodSeconds`; after that UTC boundary, this frontend never reopens offer admission. The maximum of local UTC and chain MTP is used conservatively. A fast local clock can close early; a slow local clock does not override a later chain MTP.

The six visible states are Scheduled — awaiting start; Open for offers; Overdue — awaiting activation; Activated — awaiting settlement; Expired — awaiting on-chain processing; and Completed — all periods processed on-chain. The first pre-start registration window is Scheduled. Lifetime expiry takes precedence over pending activation/settlement presentation; only a confirmed cursor at the configured count is Completed. Details show the next outstanding scheduled UTC boundary, remaining periods and outstanding activation/settlement steps.

Make an Offer navigation and form submission close at the cutoff, while stale/unverified, while activated, and at capacity/completion. Browser offer creation/preparation/registration/resume requires fresh canonical proof on two hosts. Immediately before WizardConnect signing, the worker reauthorizes the exact canonical plan, verifies current inputs, checks finality and cutoff, and returns a short-lived authorization. The main thread checks its age and UTC cutoff again. The worker repeats canonical verification and cutoff checks during submission and immediately before broadcast. Crossing the deadline during wallet approval prevents submission. Prepared wallet-owned outputs and recovery journals remain intact.

**Upper registration deadlines are frontend policy, not consensus-enforced upper deadlines under the existing covenant.** Other clients can register late while the on-chain state remains open. Activation still freezes all covenant-valid registrations; this frontend cannot retroactively exclude one. Immutable snapshots, priority cross-products and canonical slot tie-breaking are unchanged.

## Mandatory automation and safety

The worker starts processing after canonical synchronization without a wallet, approval, click or setting. The checkbox, setter, preference and message-based disable handler are removed. The old `arena-chipnet-automatic-settlement` value is ignored and removed. A versioned mandatory reader channel prevents a legacy off/optional tab from becoming its leader. Same-origin per-vault Web Locks and the existing durable intent journal continue coordinating across reader configurations. A diagnostic Process Period retry remains; automatic processing never depends on it.

One transition is proposed from a **confirmed** canonical state. Mempool spends are observed only to wait/reconcile. No unconfirmed child state is applied or used for construction. Following confirmation, the worker reconciles the journal and processes the next eligible transition. Overdue periods remain sequential. Reloads preserve submitted intents and re-read proofs before doing anything else. Competing confirmations and reorganizations are reconciled through the existing replay.

Every candidate retains local BCH-2026 VM/covenant validation, exact source values/tokens, two-host tip/MTP/history/UTXO agreement, pinned pre-broadcast verification, write-ahead persistence and the fixed fee. Freshness is rechecked immediately before sending; data aging out during verification prevents broadcast. Provider, storage or coordination failures are automatic safety interlocks, not user-controlled settings.

Automatic processing spends only the state NFT and its paired covenant pool. It never selects wallet coins or requests WizardConnect signatures. The pool carrier and staker token collateral remain protected. Fees and winning allocation carriers must fit in **pre-transition excess BCH**, above the full outstanding reward caps plus the state carrier. Released rewards cannot fund the same transition's fee. Insufficient excess or relay rejection blocks processing rather than borrowing wallet funds or weakening reserves.

Browser processing cannot continue with the website closed, a suspended tab, an offline device, unavailable public Electrum, or unavailable browser resources. Activation still waits for chain MTP strictly beyond its boundary even if wall-clock status is already overdue/expired. Mining and relay acceptance are not guaranteed. Guaranteed unattended processing requires an independently operated keeper. Independent browsers can race; only canonical UTXO validation determines the accepted state. Electrum history/non-spending and full accumulated-work consensus are not proven by this browser reader; existing server-trust limitations remain.

## Tests

- 47 frontend tests passed across 13 files: statuses, late UTC cutoff with lagging MTP, no opt-out, saved false preference removal, worker/indexer recovery, catalog reload and stale-state safeguards.
- Four native Chromium/WSS tests passed: zero-interaction sequential processing, independent profiles converging on a single spend, persisted pending intent plus tab takeover, and contradictory-provider blocking/recovery. Targeted reruns also proved zero wallet-spending RPCs and recovery without a reload/toggle.
- Keeper, wallet and schedule regressions passed, including immutable winner/snapshot behavior, uncertain acknowledgement, persistence failure, competing spends, reorgs, no unsafe reward-funded fees and final-boundary freshness. Existing Electrum and wallet scan regressions passed.
- All four BCHN regtest covenant suites passed: allocations (113 confirmed and independently relayed test transactions), UTC deadline counterexample, legacy frozen snapshots/reserves, and legacy registry authentication/cancellation/settlement. These were regtest fixtures, not new chipnet vaults/offers. The local test node's unloaded dev wallet/network state was corrected to meet the suites' documented prerequisites before rerunning successfully.
- Root/frontend type checks and the chipnet `/staking-arena-site/` production build passed. Vite retains the existing large-bundle advisory. No covenant sources or artifacts were changed.

## Existing chipnet vault and attribution

Genesis: `599bf07357f64c2b2dbf36c666fdf0655c1fc7bb38feb89c90a16517166853fc`.
Canonical state category: `d5920d56cac5f28bb44f7882a95c9b96174507594862d8ea0b782304ff0a1f04`.
Immutable terms: epoch `1794496500`, 2 periods, 300 seconds, maximum reward 1,000 satoshis per period.

At the initial read (16:19 UTC), period 0 was already activated by transaction `f750b6dc7aed1ff950ad69759e47c3c3f37e0b0ebb344077af0bdc188c4087b9`, confirmed at height 332035. That activation is **not attributed to this task's browser**. An independent actor's empty advance `4bc7217a952bb88b7fae0b365b49837288bad73b010eedea0ada4afea5adea02` confirmed at 332036, and its period-1 activation `b87bcdcbdae3cd00eda7ede1387f5a01de58fdc77421f9516781fa2100a22200` confirmed at 332037. The test browsers correctly adopted these states and waited for competing mempool spends rather than duplicating them.

At 16:38:10 UTC, after confirmed activation at 332037, the task's independent secondary browser **automatically submitted** empty advance `82eddbe19b522bcb93423f972296df1f9cd85e9c832ce626c8d03db5108e3912`. Its fixed fee is 10,000 satoshis; no wallet was connected and the only wallet-worker RPC observed was `start`. The primary browser's provider-verification failure stopped it from sending. Both browsers then observed the same pending transaction. Browser reload, offline/online recovery and a complete browser restart retained pending-state reconciliation; no processing controls were clicked.

The pre-restart trace is [mandatory-settlement-before-restart.json](mandatory-settlement-before-restart.json); final-build recovery and completion are tracked in [mandatory-settlement-final-build.json](mandatory-settlement-final-build.json). The final advance confirmed at **height 332038**, block `0000000000000da29912123261de7d9ab6042401ff54a09428d1e7daca68c597`. Both live profiles displayed **Completed — all periods processed on-chain**, with zero remaining periods/steps and Make an Offer disabled. The secondary profile restored its journal after the full browser restart and marked the same transaction confirmed with **attempts = 1**.

Independent read-only checks on `chipnet.imaginary.cash` and `electrum-chipnet.optnlabs.com` agreed on every transaction/block hash and the final state. At tip 332039 the final advance had two confirmations. All four transitions used exactly the preceding confirmed state NFT/pool as their only inputs; each paid exactly 10,000 satoshis, leaving state BCH 67,000 → 57,000 → 47,000 → 37,000 → **27,000**, plus the unchanged **1,000-satoshi pool carrier**. Each transition had sufficient pre-transition excess without consuming the then-committed reward reserve. See [two-provider chain verification](mandatory-settlement-chain-verification.json).

| Period | Transition | Height | Transaction |
| --- | --- | --- | --- |
| 0 | Activate (independent actor) | 332035 | `f750b6dc7aed1ff950ad69759e47c3c3f37e0b0ebb344077af0bdc188c4087b9` |
| 0 | Advance empty (independent actor) | 332036 | `4bc7217a952bb88b7fae0b365b49837288bad73b010eedea0ada4afea5adea02` |
| 1 | Activate (independent actor) | 332037 | `b87bcdcbdae3cd00eda7ede1387f5a01de58fdc77421f9516781fa2100a22200` |
| 1 | Advance empty (this task's automatic browser) | 332038 | `82eddbe19b522bcb93423f972296df1f9cd85e9c832ce626c8d03db5108e3912` |

No chipnet vaults or offers were created for testing. No WalletConnect/WizardConnect transaction signing or wallet-owned inputs were used by the automatic processor. Existing journals, local catalogs and recovery records were retained. Actual empty-period processing is proven here; winning payouts, adversarial ranking and collateral preservation were covered by deterministic VM and BCHN regtest suites rather than new test offers on public chipnet.


## Publication and rollback

Production compiled commit: **`53dc760a6e16bc162ad9a0e76829fe5163ab9e46`** at https://scinklja.github.io/staking-arena-site/ . GitHub Pages reported this commit **built** without error. All eight compiled candidate files matched their served SHA-256 hashes, and nine previous hashed assets remained available. See [delivery receipt](mandatory-settlement-deployment.json) and [release manifest](mandatory-settlement-release-manifest.json).

A fresh published-origin browser with the saved disable preference set to false loaded the existing vault, removed/ignored that preference, and displayed **Completed — all periods processed on-chain**, with offers disabled, no opt-out, no wallet connected, and no wallet-spending RPCs. This verification used public chipnet Electrum and blocked private/API HTTP requests. Its trace is [published live verification](mandatory-settlement-live.json).

Immediate previous production `552000382d2a99c2f863efe6802f0fe44d57b956` is preserved on `rollback/pre-mandatory-settlement-2026-11-12` in `scinklja/staking-arena-site`; all older rollback branches are unchanged. Restore the rollback branch's compiled tree onto main and commit/push to roll back without rewriting history. Already-open tabs should reload to use the mandatory-processing build. No wallet/catalog/journal reset is necessary.

Runtime source commit: `1e5cdfb5eb8f4dabec4dc3e921276515bc8ee9b0`, based on the published v1 discovery correction in an isolated worktree. Unpublished generalized-asset/v2 source was excluded. Only compiled HTML/JS/CSS/SVG and `.nojekyll` were published; no source maps, source tree, browser profiles, wallet data or credentials were copied. The read-only chain verifier is reproducible with `node --import tsx scripts/verify-mandatory-chain.ts` from the source workspace. Verification-only follow-ups do not change deployed runtime bytes.

Published-origin verification completed at 2026-11-12T17:08:31.860Z with fresh canonical period 2, Completed status, no opt-out, a removed legacy disable preference, disabled offer admission, no browser errors, and wallet-worker methods limited to `start`.
