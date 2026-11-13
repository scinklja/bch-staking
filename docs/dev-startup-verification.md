# Development launcher verification — 2026-11-10

Used the existing `.regtest/frontend/config.json`, checkpoint and regtest chain. No contracts, saved integration evidence, vaults or blockchain history were replaced. No blocks were mined.

- `npm run test:dev` passed cold startup, concurrent/repeated startup, Ctrl+C ownership, preservation of manually started BCHN/indexer, repeated shutdown, recovery after indexer SIGKILL and Vite/BCHN SIGTERM, and safe rejection of an unrelated port listener.
- The integration test compared the entire checkpoint and the saved config before/after; both were unchanged. The chain tip remained height 2627, hash `79b2a91bc4a3a1a1f09861bce5ac5904505083eb1f4ca4303c82e9eb49762b4b`.
- A separate stale-record check confirmed that a previous boot's record cannot terminate an unrelated process even when its PID and start tick match. Startup, reuse, stop and restart were checked again with boot identity recorded.
- `npm run typecheck` and `npm run frontend:typecheck` passed.
- `npm --prefix frontend test -- --testTimeout=30000` passed all 10 tests. The default five-second timeout produced failures under memory pressure on this approximately 1 GB VM. Overlapping checks also triggered an OS out-of-memory kill; subsequent checks were run separately.
- Live HTTP checks returned 200 for the frontend HTML, `/src/main.tsx`, the guest network interface `http://10.0.2.15:5173/`, indexer `/health`, frontend `/api/health` and `/api/vaults` (one saved vault).
- The frontend refused direct cookie-file access with 403 and rejected POST to the proxied health endpoint with 405.
- Socket inspection confirmed Vite on `0.0.0.0:5173`, indexer on `127.0.0.1:3100` and BCHN RPC on `127.0.0.1:18443`.

Windows Chrome and the Windows side of QEMU forwarding cannot be inspected from this guest. The guest interface needed by the existing forwarding was verified. No forwarding rules or public deployment were created.

After a Codex host restart stopped tool-session processes, the same launcher was started in a transient `staking-arena-dev.service` user unit to leave the application running independently of the tool session. It is not enabled at boot. `npm run dev:stop` stops its recorded services and launcher normally; daily startup remains `npm run dev`.

## Follow-up: automatic startup after VM reboot

At the user's request, the transient unit was subsequently replaced by the persistent `~/.config/systemd/user/staking-arena-dev.service`, using the versioned template in `scripts/staking-arena-dev.service`. The unit is enabled for the user manager's `default.target`, and `loginctl show-user omarchy -p Linger` reports `Linger=yes`, allowing startup before login. The unit uses the same launcher, saved configuration and network bindings.

`systemd-analyze --user verify` passed. The installed unit reported `UnitFileState=enabled`, `ActiveState=active`, and the persistent fragment path. `npm run dev:stop` gracefully stopped all three owned services, leaving the unit inactive with `Result=success`; its `Restart=on-failure` policy does not undo an intentional stop. Starting the persistent unit again restored the frontend and API. No VM reboot was performed during verification.

## Follow-up: Windows Chrome frontend loading

After the VM was rebooted, the enabled service started all three services automatically. Both API health routes and the guest network frontend returned 200. The user confirmed `/api/health` also worked from Windows Chrome, but the homepage's bare `.tsx` entry request failed. A temporary diagnostic page successfully mounted the same React app and live vault data using a queried entry URL.

The homepage now uses an explicit bootstrap with a query-qualified application entry. The user confirmed the normal homepage rendered in Windows Chrome after this change. Loading, disabled-JavaScript and startup-error messages replace the previously empty root. The temporary diagnostic page was removed. A DOM check executed the actual Vite-served modules with the real hot-reload client and live API; a simulated failed entry request verified that startup errors are visible. Frontend type checking and the production build passed. The service was restored after the build check. Blockchain service configuration and saved vault data were preserved.
