# Browser wallet development verification — 2026-11-12

Release status: **experimental publication authorized by the user without further tests; real-wallet end-to-end verification remains incomplete**. See the [experimental release record](github-pages-experimental-wallet-release.md).

Base source: `70fb4a3`, including browser settlement `0762f95`. Development branch: `dev/browser-wallet-transactions`. Previous compiled production commit: `4c420d6c7cc555c44c39ef6badc8f4fe73f0a0c3`. The public repository receives compiled assets only; the experimental deployment is recorded separately.

## Implemented

- Shared browser/Node transaction construction in `src/transactions-core.ts`, exact terms/reserve accounting in `src/wallet-terms.ts`, preserving compiled contracts.
- `src/browser-wallet.ts`, `src/electrum-wallet.ts`, and `src/wallet-store.ts`: confirmed dual-provider sources and lineage checks, local VM validation, signature/output verification, write-ahead IndexedDB recovery, permissionless factory completion, explicit retries and registration conflicts.
- `frontend/src/browserWalletClient.ts` and `wallet.worker.ts`: live WizardConnect derivations/signing and worker validation. Cross-tab locking covers status writes as well as submissions. No spending keys or seeds in the app.
- `BrowserWalletForms.tsx` and existing frontend integration: funding review, native BCH vault creation, exact token preparation/registration, approval/progress/recovery states, preserved marketplace layout.
- `vaultCatalog.ts`, browser configuration, and indexer integration: persistent verified local discovery and share links. Local imports are not global marketplace discovery.
- Protocol, VM, UI and native WSS/IndexedDB fixtures in `tests/browser-wallet.test.ts`, `tests/fixtures/wallet-chain.ts`, and the new frontend tests.

See [usage, funding, recovery and trust assumptions](browser-wallet-transactions.md).

## Automated results

- Full `npm test`: **32 passed**, including 29 regression/protocol tests and three chipnet-configuration/local-VM tests. Executed in an isolated fresh regtest checkout using identical source and dependencies. Existing milestone tag assertions used the source repository's read-only Git metadata. The historical local regtest database was preserved.
- Final focused `node --import tsx --test --test-concurrency=1 tests/browser-wallet.test.ts tests/browser-keeper.test.ts`: **13 passed**. Covers two-step creation, reserve conservation, reload/recovery, raw/signature mutations, exact token preparation/change, canonical REGISTER authorization, subsequent winner reward/allocation settlement, racing registration/reapproval, activated/completed/capacity rejection, outages, lost acknowledgements and reorgs.
- Root TypeScript checks: passed.
- Frontend TypeScript checks and `npm --prefix frontend test`: **38 passed** in 12 files.
- `npm --prefix frontend run test:electrum`: **13 passed** (native Chromium WSS, indexer/wallet workers, IndexedDB, cross-tab locks, replay, settlement and recovery).
- `npm --prefix frontend run test:browser`: **5 passed**.
- `test:static`: **2 passed**; `test:static:dom` and `test:static:browser`: passed for compiled offline/configured-API fallback, direct routes, exact offer calculation, rankings, mobile layout, persistence/recovery and no JavaScript errors.
- `node frontend/scripts/build-pages.mjs`: passed, using explicit `/staking-arena-site/` base, chipnet public WSS, empty API URL, and automatic settlement disabled by default. Production chunks remain large: approximately 904 KB UI, 728 KB indexer worker and 738 KB wallet worker before compression; full replay/dual-provider scans add latency.

### Previously intermittent failures

The keeper restart harness mined a new empty tip every 250 ms while the daemon verified historical state. This could repeatedly invalidate a correct replay with “Chain changed during projection.” The harness now mines when the mempool contains a spend, including a spend surviving SIGKILL; all assertions and verification remain intact. Historical regtest growth also made allocation/policy suites exceed their time budgets; the full run passed on a fresh isolated chain without deleting the user's existing chain.

Two existing frontend unit cases exceeded their five-second budget during concurrent browser/VM load. Scoping queries to their form/dialog and using input labels removed unnecessary whole-document accessibility traversal; the complete 38-test run passed without increasing timeouts. The IndexedDB fault-injection test now selects the indexer worker by asset name, rather than assuming it is the first worker after introduction of the separate wallet worker.

## Actual public network and wallet evidence

A fresh isolated **HD chipnet** Cashonize wallet was created through its public UI, as authorized. No seed phrase/private key was inspected or exported. Wallet-origin storage remains in an ignored local test profile; it is never copied into the frontend or public repository.

Public chipnet funding address:

```text
bchtest:zzeqmvdry69hxwdlwp4es8vquak4dcu5hqkpx7ha9c
```

Public WSS checks verified chipnet protocol identity and **zero UTXOs** at that address: `chipnet.bch.ninja:50004`, tip 331982 at `2026-11-12T06:33:44Z`; subsequently `chipnet.imaginary.cash:50004`, tip 331984 at `2026-11-12T06:50:06Z`. In the latter check bch.ninja failed to connect. This provider availability issue also prevents the required two-provider spending checks; verification was not weakened. The wallet needs at least **100,000 chipnet satoshis** plus **5,000 NFT-free fungible test-token units** for the intended small creation/offer/settlement exercise. These are test funds, not mainnet BCH. An attempted public faucet request stalled at browser verification; no CAPTCHA was bypassed.

**Actual creation/REGISTER/settlement transaction IDs: none for this task.** Deterministic fixtures use test-only keys and synthetic confirmation headers; their IDs must not be presented as public chipnet evidence. Cashonize source and WizardConnect protocol support the required contract `0x61` signature path, but source inspection and fixture signatures do not prove a live Cashonize REGISTER. Live pairing and public-key derivation were exercised successfully against the compiled frontend: Cashonize connected, and receive child 0 (`02e54d2c02b94e902f3601e42cec9999d8763a7c36838d46640aedaa8aa2aa00d0`) derived to the exact test address above. The browser synchronized both configured vaults at tip 331982, with 12 verified transactions, no page errors and no local/private API requests. A subsequent dual-provider balance scan hit an Electrum connect timeout; the reader reported stale/provider-error states without spending. Reload restored the wallet connection, the same owner key and a historical IndexedDB snapshot. An identical wallet-ready handshake now preserves the active wallet worker, covered by a new SDK-handshake regression test. A superseded worker startup error is also ignored when a freshly connected client replaces it, covered by a separate UI test. Real spending signatures remain untested until funding is available.

BCHN RPC and Node API ports 18443, 48332 and 3100 were stopped during public Electrum checks. The application architecture requires only static hosting, WSS Electrum and WizardConnect relay connectivity; local test servers serve compiled assets or deterministic protocol fixtures only.

## Release gate and remaining limits

Do not publish these flows as verified until an actual wallet-funded pregenesis, canonical genesis, token-backed REGISTER and subsequent browser activation/settlement confirm on chipnet. Record the real transaction IDs and wallet signing results first. Preserve compiled production commit `4c420d6c7cc555c44c39ef6badc8f4fe73f0a0c3` for rollback; public publication must copy compiled frontend assets only.

Initial creation requires a confirmed NFT-free fungible UTXO proving the chosen staking category in the scanned wallet. Scans and input counts are bounded; NFT-attached fungibles are excluded. Dual-provider disagreement or unavailability blocks spending. Electrum does not prove complete history/non-spending or full cumulative-work consensus. New vaults are local/imported, not globally discoverable. Journals cap at 64 entries and require exported recovery information before storage eviction. The existing factory and registry provide no creator refund of committed/excess BCH. Owner cancellation/refund/withdrawal UI is separate; the actual wallet owner key is preserved for those existing covenant rights. Background suspension and future relay policy remain limitations.

## Changed files

```text
README.md
docs/browser-wallet-transactions.md
docs/browser-wallet-verification.md
frontend/scripts/wallet-test-driver.mjs
frontend/src/App.tsx
frontend/src/BrowserWalletForms.tsx
frontend/src/WalletConnect.tsx
frontend/src/browserConfig.ts
frontend/src/browserWalletClient.ts
frontend/src/marketplace.ts
frontend/src/useArena.ts
frontend/src/vaultCatalog.ts
frontend/src/wallet.worker.ts
frontend/src/walletTransactions.tsx
frontend/tests/App.test.tsx
frontend/tests/BrowserWalletForms.test.tsx
frontend/tests/WalletConnect.test.tsx
frontend/tests/electrum/wallet.spec.ts
frontend/tests/electrum/worker.spec.ts
frontend/tests/vaultCatalog.test.ts
src/browser-keeper.ts
src/browser-wallet.ts
src/electrum-wallet.ts
src/transactions-core.ts
src/transactions.ts
src/wallet-store.ts
src/wallet-terms.ts
tests/arena-empty.test.ts
tests/browser-wallet.test.ts
tests/fixtures/settlement-chain.ts
tests/fixtures/wallet-chain.ts
```

## Funding continuation and provider recovery

User funding transaction `daf1ef9c6c66732cb274036a94133dbf5cc02d184ae2dd498875a9db2e3a10a0` pays output 0 to the isolated test wallet: **15,000 satoshis, no CashTokens**. Confirmed at chipnet height **331985**, block `000000000000046a1551052fecef69b3ec1427ccbda5b464d752866744c65474`. Imaginary Cash and OPTN returned identical raw transaction bytes and the same confirmation block. The two-provider current-source verification passed at tip **331986**, proving the listed source was available according to both servers; this does not cryptographically prove non-spending. This transaction is funding evidence, not creation/REGISTER/settlement evidence.

At least **85,000 additional chipnet satoshis** and **5,000 NFT-free fungible test-token units** are still needed for the planned 100,000-satoshi test budget. No application spending has occurred.

The development WSS defaults were reordered to Imaginary Cash and OPTN, with Ninja retained third for read failover. The replacement passed the existing chipnet/protocol/proof checks, canonical genesis raw decoding and CashToken NFT UTXO retrieval. Source/VM checks were not weakened. Root/frontend typechecks, **18 protocol/wallet/keeper tests**, and the production build passed after the endpoint change. Previous complete regression/frontend results above remain the baseline; the endpoint edit does not change contracts or transaction construction.

The rebuilt static frontend then completed its actual Cashonize-derived dual-provider balance scan: **61 public addresses**, **0.00015000 BCH token-free balance**, and **no eligible fungible tokens**. The UI displayed “Balances verified on both public providers,” with no saved spending operations. The reader also synchronized the two configured vaults over Imaginary Cash. BCHN and the Node API remained stopped; no wallet spending signature was requested and no transaction was broadcast by the app. Provider recovery is therefore verified; additional funding is the remaining live-transaction blocker.
