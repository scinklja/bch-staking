# Experimental chipnet wallet scan correction — 2026-11-12

The published Create Vault worker previously rejected every change of Electrum tip, including an ordinary new block. Repeated header-chain downloads per UTXO made scans longer and more likely to cross a block boundary.

The correction proves whether a changed tip extends the original tip using linked headers. An extension discards the partial snapshot and automatically restarts the entire two-provider scan. A same-height replacement, rollback, contradictory header/proof, inconsistent balance, or network error also discards the snapshot. Every accepted scan requires both independent configured providers to report the same tip and identical verified confirmed UTXOs. The first provider's tip is checked again after reading the second provider. Three attempts maximum, with one- and two-second backoffs and visible address/provider/attempt progress. Exhaustion gives connection/provider synchronization and manual retry instructions.

All supplied wallet children are checked, including children beyond an unused gap, within the existing 40/200 children per receive/change/defi branch limits. Four address reads run concurrently; outstanding reads finish before a failed pinned session is closed. CashToken-inclusive UTXO requests, exact raw-output checks, Merkle proofs and linked confirmation headers remain required. Shared confirmation headers are linked once per provider. Transaction-count limits are enforced when concurrent raw reads complete.

A new scan immediately clears the previous inventory in the worker and form; a failed refresh cannot authorize creation from an earlier inventory. Results from a replaced wallet client cannot populate the new wallet form. The funding review control still requires a successful scan, valid form and explicit acknowledgement. Current input checks on two providers before approval and again after signing/before broadcast are retained; scan results alone never authorize signing or broadcast.

## Scope and reproducibility

The release was built in an isolated source worktree based on published source `c1a70fa`, with only the scan correction and verification files applied. Unpublished generalized asset work in the main workspace was excluded. No covenant sources, bytecode or network authorization changes were made. Mainnet stays disabled. No signing or on-chain transaction is needed for the live scan check.

Source worktree: `.pages-release/scan-fix-source`. From that worktree's `frontend` directory, run `node scripts/build-pages.mjs`. The build uses the existing public chipnet WSS configuration and `/staking-arena-site/` base. Only compiled HTML/JS/CSS/SVG and `.nojekyll` are published; no source maps, secrets, wallet profiles or private source files are uploaded.

## Validation

- 21 wallet/Electrum/scan regression tests passed against the isolated release source. The initial nine new scan tests cover normal extension during reading and between providers, genuine and repeated reorganization, provider disagreement, persistent and transient outage, addresses after an unused gap, CashTokens/NFT preservation, shared proof-header verification, and failed-refresh inventory invalidation.
- The final scanner was rerun after draining concurrent reads was added: all nine scan tests passed. Two additional regressions then passed for differing otherwise valid provider inventories and a tip change at the final first-provider recheck (11 scan tests total).
- Frontend release suite: 39 tests passed in 12 files, including progress, failed-refresh disablement, and funding button recovery. The published baseline had a stale test expecting two default providers while the existing configuration has three; the test expectation was corrected without changing production endpoints.
- Root and frontend type checks, the chipnet Pages production compilation, and whitespace checks passed. Vite reports the existing large-bundle advisory.
- The deployed site passed live Cashonize verification as recorded below. No live wallet creation or token-funded spending is claimed.

## Deployment and rollback

Production: https://scinklja.github.io/staking-arena-site/

Compiled deployment commit: `b421663ce72e4155f02924746da452dcce1cf3bc`.

Immediate previous experimental release: `9b89049ff3569823dbe407eb439a7633dad2c1d7`, preserved as `rollback/pre-wallet-scan-fix-2026-11-12` in `scinklja/staking-arena-site`. Existing `rollback/pre-experimental-wallet-2026-11-12` (`4c420d6`) and `rollback/pre-serverless-2026-11-11` are unchanged. Roll back by restoring the desired rollback branch's compiled tree onto main and committing/pushing, without rewriting history.

## Live wallet and delivery results

At 14:18:33–14:19:06 UTC, the actual Cashonize web wallet (existing isolated chipnet profile) paired to the **published GitHub Pages origin**, shared only public derivation information, and completed the deployed worker scan in **31,675 ms** on its first attempt. Both `wss://chipnet.imaginary.cash:50004` and `wss://electrum-chipnet.optnlabs.com` verified all **120 addresses** (40 children on each of receive/change/defi). Result: **15,000 satoshis (0.00015000 BCH)** token-free BCH; no fungible token balances displayed. Earlier local compiled-candidate scans returned the same balance.

The live test asserted that funding review stays disabled before scanning and without acknowledgement, becomes enabled with a verified scan plus valid form entries and the required checkbox, and becomes disabled again for an invalid category. The category used in the form came from an existing public configured vault; this test wallet has no confirmed fungible staking category and insufficient BCH for the example funding plan. No funding review/signing control was clicked, no operation was created, and no transaction was signed or submitted. The runtime source-coin and category checks still enforce funding requirements before signing.

The live scan encountered a stable tip and succeeded on attempt one; actual live reorganization/retry behavior is not claimed. Block extension, reorganization and contradictory/outage behavior were exercised in deterministic regression tests. There were no page errors. Detailed timestamped progress and readiness assertions are in [wallet-scan-live.json](wallet-scan-live.json).

GitHub Pages reported `b421663ce72e4155f02924746da452dcce1cf3bc` **built**, with no error. At 14:15:59 UTC, every public asset returned HTTP 200 and matched the release SHA-256 manifest, including the wallet worker. See [wallet-scan-deployment.json](wallet-scan-deployment.json). The rollback branches were checked on the remote after publication.

The runtime release source is commit `9a0c29dbad76e46289046113b8dc1124c3132254` based on `c1a70fa`; subsequent verification-only commits add tests and the completed live verifier without changing the deployed runtime. The runtime source is also applied to the main workspace for future development. The GitHub connector returned 403 on branch creation, so deployment and rollback preservation used the already authenticated local GitHub account.
