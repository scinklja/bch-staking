# WizardConnect real-wallet verification

Verified on 2026-11-10 against the deployed **https://cashonize.com** web wallet, using fresh, unfunded BCH HD wallets in an isolated Chromium wallet context and the actual Staking Arena frontend in a separate origin/context. No user's existing wallet, seed or funds were used. This was real wallet code and real public relay traffic, not the mocked relay used by the unit tests.

**Desktop wallet connectivity passes. Regtest transaction compatibility does not. Physical mobile QR scanning and native mobile wallet handoff remain unverified because the available device is a desktop browser.** Transaction signing and broadcasting remain outside this verification.

Sanitized observations are recorded in [wizardconnect-verification.json](wizardconnect-verification.json). The evidence deliberately excludes seed phrases, wallet private keys, full xpubs, relay private keys, session secrets and pairing URIs. The test wallet's public receive address and hashes of its public derivation paths are included for comparison.

## Environment and wallet coverage

- Staking Arena: `http://127.0.0.1:5173`, existing Vite development server, existing read-only indexer and BCHN regtest environment.
- SDK versions: `@wizardconnect/react` 0.2.3, `@wizardconnect/core` 0.2.5, `@wizardconnect/dapp` 0.2.2.
- Browser: Chromium headless shell 158.0.8127.18 on Linux. Separate browser contexts isolate the website and wallet storage. The browser was automated with Playwright; relay traffic was not mocked or intercepted.
- Relay defaults in the installed SDK: `wss://relay.riften.net:443` and `wss://relay.cauldron.quest:443`. Successful wallet messages prove transport worked; this does not independently certify availability of each relay.
- Deployed wallet entry: `https://cashonize.com/assets/index-B_7E5_sy.js`, SHA-256 `61fb3d1401aadcec9cfd1109e1849761097caefcd152854dc6cd5cdde172fcfa`.
- Supplemental source review: [Cashonize commit 3b7ae7ba3d1695349bc75b89223d528282fc0c98](https://github.com/cashonize/cashonize-wallet/tree/3b7ae7ba3d1695349bc75b89223d528282fc0c98), whose package version is 0.15.2. The hosted wallet does not display its web build version in settings; no claim is made that the deployed bundle was built from precisely this commit.

| Wallet / environment | Status | Regtest compatibility |
| --- | --- | --- |
| Cashonize web, HD, mainnet | Real pairing, address derivation and lifecycle verified | No: observed mainnet xpubs and `bitcoincash:` address |
| Cashonize web, HD, chipnet | Real pairing and receive-address derivation verified | No: wallet selected chipnet, supplied testnet-family public keys and a `bchtest:` address |
| Cashonize web, single-address | Not exercised; current source requires HD or offers conversion | Unverified; do not treat as supported by this test |
| Cashonize testnet4 | Not exercised; current source deliberately disables dApp connections | No regtest support implied |
| Cashonize native Android | Source declares the `wiz` URI scheme; no physical device test | Unverified |
| Other wallets / iOS native wallets | Not tested | Unverified |

## Successful real-wallet tests

| Check | Result / evidence |
| --- | --- |
| URI pairing | Copied the actual Staking Arena `wiz:` URI into Cashonize's **Connect → Connection URI → Connect New dApp**. Cashonize presented explicit public-address sharing consent. Approval produced **Connected to Cashonize** in Staking Arena and **Staking Arena / Connected** in Cashonize. |
| QR generation and decoding | Exported the actual Staking Arena QR canvas as PNG and supplied it through Cashonize's real **Choose image** scanner. Its QR decoder accepted the generated QR representation, presented consent and completed real pairing. No decoder mock was used. This is image-based QR verification, not a physical camera scan. |
| Session negotiation | Observed `wallet_ready` and `dapp_ready`, selected protocol `hdwalletv1`, and `receive`, `change`, `defi` public paths. Each mainnet path decoded as a depth-4 extended public node. |
| Public address derivation | Derived receive child index 0 from the shared receive xpub with libauth, then encoded P2PKH CashAddress. It exactly matched Cashonize's wallet UI: `bitcoincash:qrfslwvgul268d0elz6lf5fkae8us5ydzud6vu85qh`. No wallet seed or private derivation was used by the website or address check. |
| Refresh reconnection | Reloaded the actual Staking Arena page. It reconnected to Cashonize without a QR dialog, retaining the same relay identity, wallet public identity, public paths and derived receive public key. Protocol remained `hdwalletv1`. |
| Website-initiated disconnect | Clicked **Disconnect** in Staking Arena. Its saved session was cleared; Cashonize removed the session and notified that Staking Arena disconnected. Reloading Staking Arena did not reconnect. |
| Wallet-initiated disconnect | Removed the session in Cashonize. Staking Arena showed **Wallet disconnected**, cleared the saved session and remained disconnected after refresh. Observed delay was 8,562 ms, consistent with the installed dApp SDK's 8-second remote-disconnect grace period. |
| Web-wallet URL entry | Navigated the same real wallet context to `https://cashonize.com/?uri=<encoded pairing URI>` at a 390 × 844 viewport. Cashonize presented consent and paired successfully. This is the wallet's web URL entry path; Staking Arena's current **Open wallet** control itself still uses `wiz:`. A mobile viewport is not a mobile OS test. |

## Private material and privacy findings

The observed `wallet_ready` message had these top-level fields: `action`, `supported_protocols`, `wallet_name`, `wallet_icon`, `time`, `dapp_discovered`, `session`, `public_key`, `secret`, `extensions`. Its `hdwalletv1` session provided public derivation paths. The observed message scan found no `xprv`, `tprv`, mnemonic or wallet-private-key fields. All three shared derivation keys decoded as extended **public** keys. The website context had no wallet IndexedDB databases.

**The website does store a field named `privateKey`. It is the website's own relay-identity private key, not a wallet spending private key.** A live pairing check confirmed that this key already existed before wallet approval and was unchanged afterward. The SDK generates it independently when initiating a relay. Likewise, the stored `secret` and the handshake `secret` are pairing credentials; they are not recovery phrases. Stored session fields were `privateKey`, `secret`, `walletPublicKey`, `walletName`, `walletIcon`, `paths`.

The bounded conclusion is that no wallet spending private key or recovery seed was exposed in the observed handshake or saved website session. No seed export, backup view or private-key export was opened. This is a run-specific observation and source review, not a complete security audit of the wallet or transport.

Xpubs are sensitive public information: they allow address derivation and monitoring of wallet activity. Disconnect removes the saved active session; it cannot revoke public information already received. Cashonize explicitly warns about this before approval. See the [protocol](https://docs.riftenlabs.com/wizardconnect/protocol/) and [Cashonize's wallet adapter](https://github.com/cashonize/cashonize-wallet/blob/3b7ae7ba3d1695349bc75b89223d528282fc0c98/src/stores/wizardconnectStore.ts).

The observed outgoing protocol actions during instrumented mainnet pairing/reconnection/disconnect were `dapp_ready` and `disconnect`. No signing request was sent during those observations. The application source contains no signing/broadcast invocation, and both transaction submission controls remain disabled. Connection transport necessarily signs relay authentication/events internally; those are not BCH transaction signatures.

## Network compatibility

The existing BCHN node and indexer both reported **regtest**, height **2627**, tip **79b2a91bc4a3a1a1f09861bce5ac5904505083eb1f4ca4303c82e9eb49762b4b**. Its mempool was empty before and after testing. Final checks confirmed the same height and tip, plus unchanged SHA-256 hashes for all 25 checked files: the saved frontend configuration, all covenants and all compiled artifacts.

Successful WizardConnect pairing does not prove blockchain compatibility. The mainnet wallet session successfully connected to the regtest-labelled app: the current integration does not reject that mismatch. The standard handshake used here does not provide a verified chain/genesis identifier. Mainnet xpubs identify a key-version family; testnet xpubs also cannot distinguish chipnet, testnet4 and regtest. Changing an address prefix or deriving the same public key on another network would not connect a wallet to this node or give it access to regtest UTXOs.

A separate fresh, unfunded chipnet HD wallet also paired successfully. Deriving its receive child 0 from the shared public key produced `bchtest:qpn6vnr9zu756av240zuqar9gcvyyalajc7eppqjl6`, exactly matching its wallet UI. The xpub decoded as testnet-family, while the app remained on regtest and did not reject the mismatch.

Cashonize's deployed **Add development wallet** selector offered **chipnet** and **testnet4**, with no regtest option. Current [network configuration source](https://github.com/cashonize/cashonize-wallet/blob/3b7ae7ba3d1695349bc75b89223d528282fc0c98/src/utils/wallet/networks.ts) lists mainnet, chipnet and testnet4 and disables dApp connections on testnet4 because its identity cannot be distinguished from chipnet through these protocols.

**No wallet tested here is established as a regtest transaction wallet for this project.** Future transaction work needs a wallet/backend that explicitly supports this private regtest chain and a trustworthy network/chain check. The present **Connected** status confirms only the wallet session.

## Errors, limits and reproduction notes

- Physical camera / mobile OS: not available. Cashonize's scanner reported camera permission/access failure in this environment; **Choose image** succeeded. User confirmed a desktop-browser setup. Native Android/iOS handoff, camera focus/scanning and app install/return behavior remain pending.
- Desktop **Open wallet**: the link matched the generated URI, but no `x-scheme-handler/wiz` handler was registered on this machine. Clicking it did not launch cashonize.com. Using the browser wallet alone does not register a native URI handler. The separate web URL entry test above passed; that URL is not currently the app's button target.
- Desktop Cashonize initially hides its QR scanner. Enable **Settings → User options → Enable QR scan** before opening its scanner and selecting **Choose image**.
- An initial test-only React DevTools observer interfered with Vite's refresh preamble. It was discarded; successful runs used unmodified application responses and inspected the runtime manager through the existing React fiber. This observation code was not added to the product. During scanner setup, waiting for the hidden QR control timed out; enabling it resolved the issue. Test browser pages were recreated after a harness interruption, retaining only their isolated test-wallet storage.
- No application page errors were captured in the successful instrumented runs. This does not certify absence of all browser-console or network warnings.
- Only receive index 0 was cross-checked against the wallet UI. The other two shared xpubs were decoded/validated, but their derived addresses were not independently compared in the wallet UI.
- Only Cashonize's deployed web implementation was exercised. Native builds and other wallets are not certified by this report.
- No API writes, wallet funding, mining, covenant compilation, BCH transaction signing, broadcasting, deployment or publication were performed. Existing blockchain data was not reset or replaced. Final preservation checks are recorded in the JSON evidence.

To repeat, use an unfunded **HD** wallet in a separate browser profile/context. Pair using the header URI or an image of its QR, approve the sharing consent in Cashonize, compare the public receive derivation, refresh the dApp, and disconnect from each side in separate sessions. Do not paste a recovery phrase or wallet private key into Staking Arena. For the remaining mobile tests, use a physical device and record its OS, wallet build, QR camera result, installed URI handler, native launch/return result and the observed network independently.
