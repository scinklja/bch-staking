# Electrum implementation verification — 2026-11-11

Development branch: `dev/electrum-indexer`. No deployment, public website update, mainnet enablement, keeper change, covenant source change, or covenant bytecode change.

## Results

| Execution | Result |
| --- | --- |
| `npm run typecheck` | Passed in the existing working tree and in an independent checkout of the staged commit. |
| `npx tsx --test tests/electrum.test.ts` | 5 test groups passed; includes exact wire/token decoding, real captured vault replay, API routes and write rejection, restart, unordered same-block history, immutable snapshots, UTXOs, withdrawals, shorter-chain and same-height replacement reorganizations, omitted lineage, invalid proofs/headers, stale tips, disconnects, unconfirmed separation, actual local socket timeout/reconnect/failover, mainnet and broadcast rejection. Also passed with `ARENA_NETWORK=regtest` inherited at launch: the fixture explicitly selects chipnet and injects its provider. |
| Public chipnet connectivity | Passed against both `ssl://chipnet.bch.ninja:50002` and `ssl://chipnet.imaginary.cash:50002`, including CashToken-compatible protocol negotiation, network pins, raw transaction decoding, Merkle proof and history/UTXO protocol calls. See `electrum-connectivity.json`. |
| `npx tsx scripts/electrum-verify.ts config/electrum-chipnet.json docs/electrum-verification.json` | Passed on a real configured chipnet vault: registration → activation → settlement, allocation, confirmed withdrawal, UTXO checks, durable restart with identical state, all GET vault routes and transaction status returning 200, write route returning 405. RPC pointed at closed port 1 with a nonexistent cookie; normal operation did not use BCHN. |
| Actual staged service startup, SIGTERM, restart | Passed twice with `ARENA_PROVIDER=electrum ARENA_NETWORK=chipnet node --import tsx scripts/arena.ts CONFIG`, the same checkpoint, unreachable RPC and missing cookie. Healthy public chipnet tip and identical vault witness across restart. See `electrum-daemon-verification.json`. |
| `npm --prefix frontend run typecheck` | Passed against the user's existing frontend working tree. |
| `npm --prefix frontend test` | 8 files, 28 tests passed against the user's existing frontend working tree. No frontend file was changed for this task. |
| `npm test` | Initial broad run: 14 tests, 12 passed, 2 failed. Compilation and typechecking passed. Failures detailed below; both passed on targeted rerun. This command launched before the new Electrum test file existed; its 5 test groups were executed separately. |
| `ARENA_NETWORK=chipnet npx tsx --test tests/chipnet-flow.test.ts` | Passed (1 test) on targeted rerun. Local VM only; no public transaction sent. |
| `ARENA_NETWORK=regtest npx tsx --test tests/allocations.test.ts` | Passed (1 test, approximately 355 seconds) on targeted rerun, including 16 registrations, three independent allocations, consensus/economic checks and withdrawal behavior. |

The initial broad-run failures were:

- `tests/allocations.test.ts`: `Relay peer timeout: initial block sync` during fixture setup, before assertions about allocations. The unchanged test passed on rerun after the relay had synchronized.
- `tests/chipnet-flow.test.ts`: its module-level shared provider was constructed while `ARENA_NETWORK=regtest`, before the test changed the environment to chipnet. CashScript correctly rejected a `bchtest` output on a `bchreg` provider. The unchanged test passed when launched with `ARENA_NETWORK=chipnet`. This pre-existing mixed-network test-suite setup was not changed in this Electrum phase.

The existing keeper/indexer regression passed its full catch-up, sponsorship, competing spends, BCHN outage/restart, withdrawal, rollback, fresh reconstruction, checkpoint and API checks. The keeper daemon restart/exclusive-checkpoint test passed. Legacy vault, registry, allocation policy and integration tests passed in the broad run or the allocation rerun. Compiler-generated artifact timestamp changes and unrelated test-report changes were restored; no covenant bytecode was changed.

The chipnet BCHN process already running on this machine was not stopped or altered. Electrum verification explicitly made RPC unavailable **to the service under test** through a closed endpoint and missing credentials, rather than interrupting that unrelated process. The regtest node started for regression tests was shut down afterward. Verification services were shut down. No public transaction was broadcast by the new adapter or its diagnostics.

## Files in the implementation commit

| Area | Files |
| --- | --- |
| Adapter and indexer | `src/electrum.ts`, `src/indexer.ts` |
| Exact amounts, genesis and provider injection | `src/arena.ts`, `src/genesis.ts` |
| Read API and existing chipnet/backend prerequisites | `src/api.ts`, `src/http-policy.ts`, `src/rpc.ts`, `src/provider.ts`, `src/token-provider.ts` |
| Startup and configuration | `scripts/arena.ts`, `config/electrum-chipnet.json`, `package.json`, `.gitignore` |
| Reproducible diagnostics | `scripts/electrum-check.ts`, `scripts/electrum-capture.ts`, `scripts/electrum-verify.ts` |
| Deterministic tests and public response fixture | `tests/electrum.test.ts`, `tests/fixtures/electrum-chipnet.json` |
| Documentation and live evidence | `README.md`, `docs/electrum.md`, this report, `docs/electrum-connectivity.json`, `docs/electrum-verification.json`, `docs/electrum-daemon-verification.json` |

The starting checkout contained substantial unrelated uncommitted frontend, wallet and deployment work. It has been preserved. The implementation commit includes necessary existing backend chipnet/CORS prerequisites, while leaving unrelated frontend, wallet intent, keeper and deployment edits unstaged. The staged commit was exported and tested independently so it does not depend on those unstaged files. The committed API is read-only; the user's pre-existing wallet routes remain in their working tree and are explicitly disabled in Electrum mode.

## Remaining limits

See [architecture and protocol trust limits](electrum.md): explicit configured genesis discovery, complete-history/non-spend assertions requiring server trust, server-selected headers rather than full local consensus validation, no reliable dropped/orphan classification, bounded server responses, full replay cost, and no global discovery or browser transport. Reorganization and failure tests are deterministic modifications of captured protocol data, not claims of observing a real public reorganization. The HTTP API still needs a running Node process; a future browser reader would require WSS transport and browser persistence. No Railway, VPS, Chaingraph or browser keeper is required or added.
