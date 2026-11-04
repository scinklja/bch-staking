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
 bitcoind -datadir="$DATA" -regtest -daemon
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
