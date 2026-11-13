#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
DATA="$PWD/.regtest"
mkdir -p "$DATA"
chmod 700 "$DATA"
cp scripts/bitcoin.conf "$DATA/bitcoin.conf"
cli() { bitcoin-cli -datadir="$DATA" -regtest "$@"; }
case "${1:-status}" in
 start)
 if ! cli getblockcount >/dev/null 2>&1; then
 # Regtest tests can mine beyond wall time. BCHN otherwise rejects its own
 # future-dated tip during a restart, before RPC becomes available.
 regtest_clock="${ARENA_REGTEST_MOCKTIME:-}"
 if [[ -z "$regtest_clock" && -f "$DATA/clock" ]]; then read -r regtest_clock < "$DATA/clock"; fi
 regtest_clock_args=()
 if [[ -n "$regtest_clock" ]]; then
 [[ "$regtest_clock" =~ ^[0-9]{1,10}$ ]] && (( regtest_clock <= 4294967295 )) || { echo 'Invalid saved regtest clock'; exit 2; }
 if (( regtest_clock > $(date +%s) + 7200 )); then regtest_clock_args=("-mocktime=$regtest_clock"); fi
 fi
 bitcoind -datadir="$DATA" -regtest -daemon "${regtest_clock_args[@]}"
 ready=0
 for i in {1..100}; do
 if cli getblockcount >/dev/null 2>&1; then ready=1; break; fi
 sleep 0.2
 done
 (( ready == 1 )) || { tail -40 "$DATA/regtest/debug.log"; exit 1; }
 fi
 cli setnetworkactive false >/dev/null
 if ! cli listwallets | rg -q '"dev"'; then
 if cli listwalletdir | rg -q '"dev"'; then cli loadwallet dev; else cli createwallet dev; fi
 fi
 height=$(cli getblockcount)
 if (( height < 101 )); then cli -rpcwallet=dev generatetoaddress "$((101-height))" "$(cli -rpcwallet=dev getnewaddress)" >/dev/null; fi
 cli getblockchaininfo
 ;;
 stop)
 # Preserve the test clock atomically before the cookie disappears on shutdown.
 regtest_tip=$(cli getbestblockhash)
 cli getblockheader "$regtest_tip" | node -e "const fs=require('node:fs');const h=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(h.time+1)+'\\n')" > "$DATA/clock.tmp"
 mv "$DATA/clock.tmp" "$DATA/clock"
 cli stop
 for i in {1..100}; do
 [[ ! -f "$DATA/regtest/bitcoind.pid" ]] && exit 0
 sleep 0.2
 done
 echo 'Node shutdown timed out'; exit 1
 ;;
 status) cli getblockchaininfo; cli -rpcwallet=dev getwalletinfo ;;
 mine) count="${2:-1}"; [[ "$count" =~ ^[1-9][0-9]{0,3}$ ]] || exit 2; cli -rpcwallet=dev generatetoaddress "$count" "$(cli -rpcwallet=dev getnewaddress)" ;;
 rpc) shift; cli -rpcwallet=dev "$@" ;;
 *) echo 'Usage: node.sh start|stop|status|mine [blocks]|rpc <method> [args]'; exit 2 ;;
esac
