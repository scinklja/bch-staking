# Browser test reliability

## Diagnosis (2026-11-10)

The original Try Omarchy VM reported 1,154 MiB RAM, 280 MiB available and 1,063 MiB swap in use before validation. Existing static-test error reports and `trace.zip` files showed `page.goto(..., waitUntil: 'load')` timing out after 30 seconds; trace timestamps put one call at about 47.5 seconds of wall time. Context and trace teardown then exceeded the 90-second test budget. The trace's captured frame was completely white, before a rendered application appeared. This is not evidence of an incorrect vault selector.

During validation, the diagnostic sampler recorded memory pressure `some avg10=98.79`, `full avg10=64.14`, and heavy swap activity. A kernel log at 21:55:39 CET explicitly reported a global OOM and killed `quickshell`. The browser runner received SIGTERM; the unit run also terminated. Unit and browser validation had overlapped and were subsequently run sequentially. These interrupted runs are resource failures, not passing tests or demonstrated application bugs. An OOM counter alone is historical: compare its start/end values and kernel timestamps rather than assuming any nonzero value belongs to the current run.

There is also a distinct synchronization risk in cached-data tests: a snapshot banner and vault terms can render while the reload's API request is still pending. Changing the mock's online/offline state at that point can change the response to the wrong request. Recovery checks now wait for the exact enabled `Refresh data` control before changing the mock state, then assert the fresh UI. Navigation waits for DOM content and asserts the required visible application content, rather than relying on the document `load` event. No application bug was established by the old blank-page traces.

## Running checks

From the repository root, run these commands sequentially on the VM:

```sh
npm --prefix frontend ci
cd frontend
npx playwright install --with-deps chromium --only-shell
npm test
npm run test:static
npm run test:static:browser
npm run test:browser
```

`test:static` builds both offline and configured production assets and tests them with intercepted API fixtures. `test:static:browser` uses the same assets for additional ranking, offer calculation, mobile layout, polling, snapshot and GET-only checks. Neither needs BCHN or credentials. `test:browser` uses Vite with intercepted fixtures. Existing Vite can be reused locally; CI starts its own server. Keep browser QA separate from BCHN integration tests and other memory-intensive jobs.

Automated checks default to Playwright's bundled Chromium headless shell. `CHROMIUM_PATH` explicitly selects another binary when needed; there is no implicit desktop Chromium fallback. Each suite uses one worker and reuses the browser across isolated test contexts, with no automatic retries. Standalone checks keep one browser and page, including their optional live-indexer checks. The old single-process, no-zygote and 64 MiB JavaScript heap workarounds are removed. Action and navigation limits remain 15 and 30 seconds; standalone checks no longer use 120-second waits. The polling check advances Playwright's clock and observes a failed API request instead of sleeping 11 seconds.

Optional full-page captures require `ARENA_CAPTURE_SCREENSHOTS=1`; `ARENA_SKIP_SCREENSHOTS` still suppresses them. Failure captures remain enabled independently. Live checks still use the actual read-only indexer and are excluded from CI.

## Failure evidence

The npm browser commands save timestamped `frontend/browser-diagnostics/<run>/` directories:

- `memory.jsonl`: wall-clock timestamps, Linux memory and swap totals, swap/major-fault/OOM counters, memory pressure, and relevant process PID, parent PID, RSS and swap every five seconds and at start/end. Sampling may itself be delayed under severe pressure.
- `chromium.log`: Playwright browser launch arguments, Chromium stderr, PID, process exit and cleanup evidence.
- `runner.log`: test output and exit status/signal.
- `kernel.log`: recent kernel journal when accessible; an unavailable journal does not imply there was no OOM.

Playwright retains DOM/network/source traces and a screenshot only on failure in `frontend/test-results/`. Continuous trace screencast images and video are disabled. Standalone checks retain `trace.zip` and a bounded viewport `failure.png` in their diagnostic directory on failure. A dead renderer can prevent a screenshot or final trace from being saved; inspect the process and memory logs in that case. Open traces with `npx playwright show-trace <path-to-trace.zip>`.

Correlate all evidence before classifying a timeout:

- Rising OOM counters, kernel kills, browser exits/signals, sustained pressure, growing swap and delayed teardown support resource exhaustion. A sandbox/GPU warning alone does not.
- A responsive renderer, normal memory/process evidence, completed API request, and a trace/screenshot showing the wrong state support a UI or synchronization bug. Inspect locator strictness, pending requests and cached content before changing expectations.
- A blank screenshot alone cannot distinguish slow startup, missing assets, an application error, or starvation. Use trace requests, page errors and Chromium logs; keep the result inconclusive when evidence is missing.

The GitHub Actions frontend workflow installs only frontend dependencies and the headless shell, runs unit tests and both static browser checks, and uploads failure evidence for seven days. Production builds run as part of `test:static`. It does not start BCHN, run root `npm test`, run live checks, or use private credentials.

## Validation results

| Check | Result | Memory context |
| --- | --- | --- |
| Initial overlapping validation | Interrupted; kernel OOM counter rose from 0 to 1; minimum sampled available memory 110 MiB | Original 1,154 MiB VM |
| Sequential headless standalone production check | Passed; one launch; OOM counter unchanged | Original VM; minimum sampled available memory 466 MiB |
| Sequential headless static Playwright suite | 2/2 passed in 6.3 seconds; one launch; OOM counter unchanged | Original VM; minimum sampled available memory 325 MiB |
| Frontend unit/component tests | 19/19 passed across four files | VM subsequently reported 1,958 MiB RAM |
| Dev Playwright suite | 4/4 passed in 23.6 seconds; one launch | 1,958 MiB VM; no OOM counter increase |
| Fresh offline/configured builds and static Playwright suite | Both builds and TypeScript passed; 2/2 browser tests passed | 1,958 MiB VM; no OOM counter increase |
| Standalone production checks after server cleanup changes | Passed, including clock-driven polling and recovery | 1,958 MiB VM; no OOM counter increase |
| Local project-prefix production check | Passed with visible assertions, direct routes, reload, mobile, no backend requests or JS errors | 1,958 MiB VM |
| Temporary intentional missing-element probe | Expected exit 1; readable trace ZIP and failure PNG verified; no trace screencast frames; temporary spec removed | 1,958 MiB VM |

The capacity change was observed after the interrupted session; the later results do not demonstrate behavior under the original memory pressure. The two earlier sequential passes provide separate evidence for the original VM. The actual hosted workflow has not been run from this workspace. No full BCHN regtest suite was run for this change.
