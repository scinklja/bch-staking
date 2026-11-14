# V3 task interface and discovery

The default `#/v3` route retains vault creation. `#/v3/offers` lists known vaults; `#/v3/vault/<genesis>` opens a dedicated vault workspace. Hash links support reload and browser history without server rewrites. Creation values remain mounted across tab changes. V1 and V2 routes remain available.

Desktop places the verified summary and canonical offer queue beside the S/T/R form. Mobile orders summary, offer form, queue, then claims and recovery. New registrations still use `maxWins=1`. Exact integer cross-products and canonical slot order determine ranking and insertion estimates. Lock estimates use the existing consensus rounding function. Claims, cancellations, refunds, allocations, withdrawals, creation fallback, wallet approval and transaction journals retain their existing implementations and storage keys.

## Discovery source and limitations

The existing V3 `AssetIndexer` independently validates genesis, covenant transitions, linked headers, transaction proofs and current state through two Electrum providers. It requires a public configuration to derive a vault's scripts. Existing V1 discovery/API catalog infrastructure does not enumerate V3 vaults. Globally complete discovery would require a separate V3 transaction indexer or an externally maintained catalog; this frontend does not modify the on-chain registry or queue.

`frontend/public/v3-vaults.json` provides a same-origin, shared, read-only chipnet configuration catalog. Its schema is `{ "network": "chipnet", "vaults": [Config, ...] }`, with at most 32 entries. Each Config contains the existing public V3 parameters and genesis transaction ID; `cap` is a decimal string. Catalog entries are discovery hints only. List verification uses the existing two-provider replay before displaying assets, release amounts, reserve or offer count. Errors withhold financial data. No catalog writes, funded transactions, or external submission service are introduced.

No confirmed chipnet V3 vault configurations were available in the checked-in deployment evidence, so the initial shared catalog is empty. Do not add regtest fixtures or V1/V2 configurations. Maintainers can publish actual public V3 configurations by updating the catalog; browsers independently verify every entry. New user creations remain local until their public configuration is imported elsewhere or published to the shared catalog. Direct vault URLs require the configuration to be saved, imported, or present in the shared catalog.

Saved/imported configurations and pending creation journals retain their storage keys. The list is explicitly named **Known vaults**, never a complete public inventory. List verification is bounded and sequential on entry/configuration changes. Detail state refreshes on open, manual refresh, at most every two minutes while visible, return to a visible tab after two minutes, and each action. Display age never disables otherwise eligible actions; the unchanged worker revalidates again during authorization and broadcast. Pending transactions are shown separately from confirmed queue state. There is no chain polling loop for discovery.

No protocol, covenant artifacts, release rules, funding mechanisms, queue rules, fee policies or wallet signing code changed. Mainnet remains disabled. Browser transaction tests use the existing isolated regtest fixture; public checks never connect a wallet or broadcast.

The public read-only browser check exercises all four asset combinations, tab history, reload, mobile width, and V1/V2 navigation against live chipnet providers. Wallet acceptance/rejection, revalidation, W=1, ranking ties, and recovery are covered by focused frontend tests; actual Cashonize approval is not claimed as live-wallet verified. No funded chipnet transaction is part of this release verification.

## Verification

- Frontend: 22 files, 99 tests passed. Includes all 21 focused V3 UI checks, exact ranking ties, zero-buffer offer eligibility, S/T/R-only inputs, W=1, wallet rejection, signing with broadcast disabled, stale display revalidation and recovery.
- TypeScript and production compilation pass (`npm --prefix frontend run build` includes `tsc --noEmit`). The existing large-bundle advisory remains.
- Compiled read-only chipnet browser evidence: `staking-arena-v3-ui-browser-local.json`; no wallet connected, no broadcasts, no page or HTTP errors, all asset pairs, tab history, mobile width, and V1/V2 navigation passed.
- `git diff --quiet HEAD -- src contracts artifacts` confirms all protocol sources, contracts and compiled covenant artifacts are unchanged before publication.
- Four compiled browser tests passed using the existing WSS fixture: confirmed queue/claims, provider failure and reorganization, pending direct-creation journal confirmation across reload, plus tab history, verified clickable cards, direct detail reload and desktop/mobile geometry. Screenshots were inspected; desktop queue columns were then constrained to fit the column, with focused layout re-verification.
- The focused desktop/mobile layout check passed again after the table adjustment, including a desktop assertion that every queue column fits without horizontal scrolling. Mobile retains an independently scrollable queue while the summary and offer form fit the viewport.
