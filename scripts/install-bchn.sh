#!/usr/bin/env bash
# Official release, pinned signer fingerprint from upstream v29.2.0 keys.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -m) == x86_64 ]] || { echo 'This installer requires x86_64'; exit 1; }
mkdir -p downloads docs
cd downloads
mkdir -m 700 -p gnupg
archive=bitcoin-cash-node-29.2.0-x86_64-linux-gnu.tar.gz
sig=SHA256SUMS.29.2.0.asc.Calin_Culianu
curl --fail --location --retry 3 -o "$archive" "https://github.com/bitcoin-cash-node/bitcoin-cash-node/releases/download/v29.2.0/$archive"
curl --fail --location --retry 3 -o "$sig" "https://gitlab.com/bitcoin-cash-node/announcements/-/raw/master/release-sigs/29.2.0/$sig"
gpg --homedir ./gnupg --keyserver hkps://keyserver.ubuntu.com --recv-keys D465135F97D0047E18E99DC321810A542031C02C
gpg --homedir ./gnupg --status-fd 1 --verify "$sig" > ../docs/signature-verification.txt 2>&1
rg -q '^\[GNUPG:\] VALIDSIG D465135F97D0047E18E99DC321810A542031C02C ' ../docs/signature-verification.txt
gpg --homedir ./gnupg --decrypt "$sig" 2>/dev/null | rg " $archive$" | sha256sum -c - > ../docs/checksum-verification.txt
tar xzf "$archive"
mkdir -p "$HOME/.local/opt/bchn-29.2.0" "$HOME/.local/bin"
cp -a bitcoin-cash-node-29.2.0/bin "$HOME/.local/opt/bchn-29.2.0/"
for binary in bitcoind bitcoin-cli; do
 ln -sf "$HOME/.local/opt/bchn-29.2.0/bin/$binary" "$HOME/.local/bin/$binary"
done
