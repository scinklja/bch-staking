# Vault marketplace redesign

The redesign was initially prepared and validated locally. Publication to the existing GitHub Pages site was subsequently authorized; see [hosting and release verification](github-pages.md). Only compiled frontend assets are published.

## Experience

- Homepage: Staking Arena, a prominent Create Vault preview action, and a simple list sourced exclusively from the existing validated indexer response. Listings show the BCH cap, native BCH reward asset, total periods, readable duration and indexed status.
- Vault page: immutable terms, staking asset category, period progress, applicable current protocol conditions, a Make an Offer preview action and ranked competitors. Technical identifiers are collapsed under Advanced vault information; inactive live registrations are separately expandable.
- Offer preview: S raw token units, T whole periods, R BCH per winning period and W maximum wins. Exact decimal-to-satoshi conversion avoids floating point errors. P uses S × T / R in satoshis; W affects upfront S × W commitment, not priority. Bounds match the current registry: 1,000–1,000,000 units for S, 1–N for T/W, and 1,000–C satoshis for R.
- Creation preview: native BCH rewards, existing staking CashToken category, BCH cap, period seconds, 1–16 periods and UTC epoch. Reward budget is N × C excluding fees and carriers. Epoch and latest maturity respect the existing protocol's signed timestamp range. All terms are immutable after eventual publication. Category validity, balances and canonical genesis are not claimed verified by this preview.
- Both forms prominently say Form preview. Final publication/submission controls are disabled; there is no wallet connection, signing, transaction construction, broadcast, local fake offer, or fake vault insertion. CashToken rewards are explicitly future/unsupported and cannot be selected.

## Data and routing

The unchanged API layer performs read-only GET requests. There is no demo data in application source. API fixtures exist only in test files and browser interceptors. Token metadata is not available from the current indexer; no staking symbol or decimal convention is invented.

Status uses confirmed/indexed state: completed requires cursor ≥ N; upcoming requires period zero and indexed MTP before epoch; otherwise the vault is open. Late unsettled schedules stay open, even when browser time is past the schedule. Missing MTP produces Status unavailable. Activated-period ranking uses the frozen snapshot, so live cancellation does not erase a frozen competitor. Exact comparisons and lower canonical registration slot resolve priority ties.

Routes are `#/`, `#/create`, `#/vault/<64-character-category>` and `#/vault/<category>/offer`. These work below a GitHub Pages project path and survive direct navigation/reload without server rewrites. Missing vaults and invalid routes have explicit states.

Offline and last-known confirmed snapshot behavior remains intact. All restored snapshots retain a historical/not-current banner through route changes, retries and reload. Stale status badges say at snapshot, and current period becomes Period at snapshot. Original fetch and indexer synchronization timestamps remain visible. No configured API means no API requests; creation previews remain available, but no vaults are invented.

## Scope

Only frontend implementation, frontend checks and frontend documentation are changed by this redesign. Existing uncommitted local-development changes were preserved. No covenant, backend, keeper, wallet or saved blockchain data was changed; no integration suite that mines or mutates chain state was run.

## Validation

Results are recorded below after running frontend tests, typechecks, static builds and browser smoke checks. Browser screenshots use `frontend/test-results/marketplace-*.png` and are local ignored evidence.

- Frontend unit/component/model tests: **19/19 passed**, across four test files. Successful low-memory VM command from `frontend`: `NODE_OPTIONS='--max-old-space-size=112 --max-semi-space-size=2' node node_modules/vitest/vitest.mjs run --pool=threads --no-isolate --testTimeout=60000 --hookTimeout=60000`. Earlier worker starts timed out under memory pressure; incorrect new test expectations that multiplied priority by W were corrected (the implementation already correctly excluded W).
- Frontend TypeScript: passed as part of `npm run build` (`tsc --noEmit`). Both offline-default and configured HTTPS API production builds passed.
- Built application DOM smoke checks: **2/2 passed**, covering no-backend rendering, creation-route navigation and configured API outage handling. jsdom reports its unimplemented scroll method; rendering assertions pass, and real browser navigation is checked separately.
- Root TypeScript (`npm run typecheck`): passed. `git diff --check`: passed.
- Browser fixture responses receive their synchronization timestamp when served. The actual-indexer page uses normal browser time and real read-only API responses.

- Production browser smoke: offline marketplace and creation preview; direct vault/offer routes; ranking; exact offer calculation; disabled transaction controls; 390px mobile layout; historical snapshot persistence across reload/retry; and recovery were exercised successfully. Desktop details and mobile offer screenshots were captured and visually inspected. Earlier combined runs failed at a later browser-context transition or image capture under memory pressure, so the actual-indexer check is run separately.
- A third production build with `VITE_API_BASE_URL=/api` also passed. For the actual-indexer smoke, the test-only file server can serve it below `/live/` and forward only GET `/api/vaults` to the existing loopback indexer when `ARENA_TEST_API` is explicitly set. Other static checks keep this option unset and start no proxy or backend. No BCHN RPC is forwarded, and the test server binds only loopback port 4174.
- Optional PNG capture can be disabled with `ARENA_SKIP_SCREENSHOTS=1` on this VM. Functional assertions remain enabled.
- Actual-indexer production browser smoke: **passed** for **1 real indexed vault**. Verified the homepage list, keyboard navigation to actual vault details, offer-preview-only controls, mobile layout, zero browser JavaScript errors and GET-only network traffic. Evidence: `frontend/test-results/marketplace-live-check.json`. Successful command from `frontend`: `CHROMIUM_PATH=/path/to/chrome-headless-shell FRONTEND_URL=http://127.0.0.1:4174/live ARENA_READ_API=http://127.0.0.1:3100 ARENA_TEST_API=http://127.0.0.1:3100 ARENA_SKIP_SCREENSHOTS=1 NODE_OPTIONS=--max-old-space-size=128 node scripts/screenshots.mjs`. This uses the real indexer response, not a response fixture, and does not start or modify the indexer.
- The desktop and mobile PNGs referenced above depict explicit test fixtures in the production smoke harness. They are review artifacts, not fabricated application listings. Live screenshot capture and an earlier Vite browser run timed out under VM memory pressure; the final actual-data functional check passed without optional image capture.

Final browser limitation: repeated standalone fixture smoke runs on this 1 GB VM remained intermittent and sometimes timed out waiting for visibility/loading, even when failure diagnostics showed the expected rendered page. These repeated full commands are **not** claimed green. The successful production workflow assertions and screenshots are recorded above; the separate actual-indexer functional browser run completed with exit code 0, GET-only traffic and zero JavaScript errors. A machine with more memory should rerun `npm --prefix frontend run test:static` and `npm --prefix frontend run test:browser` before deployment. The original redesign phase did not publish. The subsequently authorized GitHub Pages release and its successful base-path verification are recorded in [the hosting guide](github-pages.md).
