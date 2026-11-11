#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -m 700 -p .chipnet
case "${1:-status}" in
start)
  if [[ ! -f .chipnet/bitcoin.conf ]]; then cp scripts/chipnet.conf .chipnet/bitcoin.conf; fi
  if bitcoin-cli -datadir="$PWD/.chipnet" -chipnet getblockchaininfo >/dev/null 2>&1; then
    bitcoin-cli -datadir="$PWD/.chipnet" -chipnet getblockchaininfo
  else
    bitcoind -datadir="$PWD/.chipnet" -chipnet -daemon
  fi
  ;;
stop) bitcoin-cli -datadir="$PWD/.chipnet" -chipnet stop ;;
status) bitcoin-cli -datadir="$PWD/.chipnet" -chipnet getblockchaininfo ;;
rpc) shift; bitcoin-cli -datadir="$PWD/.chipnet" -chipnet -rpcwallet=arena-chipnet "$@" ;;
*) echo 'Usage: chipnet-node.sh start|stop|status|rpc ...' >&2; exit 1 ;;
esac
