# Browser wallet transactions — experimental chipnet release

This development branch extends implementation `0762f95` and the source at `70fb4a3`. The user subsequently authorized publication as **experimental**, without further tests. Wallet creation/registration is explicitly labeled as not verified end to end with a real wallet; it must not be described as a completed live-wallet verification. The previous public compiled commit `4c420d6` is retained for rollback.

## Architecture

The portable `src/transactions-core.ts` implements the existing RegistryGenesis/Registry/StakePool layouts. Node's `src/transactions.ts` delegates creation, preparation and registration construction to it, retaining RPC readiness and node submission policy checks. Contract source/bytecode is unchanged.

`src/browser-wallet.ts` reuses the Electrum indexer, canonical replay, shared keeper source checks and local BCH-2026 VM. `src/electrum-wallet.ts` resolves bounded public wallet derivations against confirmed raw CashToken UTXOs and two distinct chipnet provider hostnames. `frontend/src/wallet.worker.ts` keeps replay/building/VM work off the UI thread. The main thread alone uses the live WizardConnect manager to request signatures, then passes public signed transaction bytes to the worker for validation. The application's transaction flow has no BCHN/RPC/Node API dependency.

The browser refuses mainnet, unsupported/unknown key families, changed wallet sessions, unconfirmed sources, source/proof/UTXO/tip disagreements, mutated outputs/inputs/locktimes, altered covenant witnesses and signatures lacking the mandated `ALL | UTXOS | FORKID` (`0x61`) flags. It validates every final signed transaction locally against freshly resolved sources before broadcasting. A final pinned session verifies all inputs, including registry and pool, immediately before submission. Broadcast acceptance never establishes confirmation.

The current Cashonize signing implementation explicitly replaces contract signature placeholders with signatures covering the contract redeem script, using sparse `inputPaths`. REGISTER uses the wallet receive child 0 for the record/authorization and the actual funding child's path for its P2PKH input. Receive/change/defi public derivations are shared by WizardConnect; no application seed or wallet spending key is generated or imported. Existing SDK relay-identity/pairing secrets are distinct from wallet spending keys and stay in the SDK, never in transaction journals or compiled assets.

Primary sources: [WizardConnect signature requirements](https://docs.riftenlabs.com/wizardconnect/protocol/#sighash-requirement-security-critical), [Cashonize contract signing](https://github.com/cashonize/cashonize-wallet/blob/master/src/utils/dapp/wizSigning.ts). Source compatibility and deterministic signatures do **not** establish real-wallet registration compatibility; actual results must be recorded separately.

## Create Vault

1. Use the private production-mode build or `VITE_INDEXER_MODE=electrum npm --prefix frontend run dev`.
2. Connect an HD chipnet wallet in the header and check its confirmed balances.
3. Select a fungible category proven by a confirmed NFT-free token UTXO in the scanned wallet. Creation does not consume staking tokens. This initial implementation deliberately restricts creation to such proven categories.
4. Enter native BCH reward cap, positive whole-second duration, 1–16 periods and the first UTC boundary. The last possible allocation maturity must fit the existing signed timestamp encoding.
5. Review all immutable terms, the exact funding breakdown and the no-refund warning. Choose a future start and keep keeper automation off until offers confirm.
6. Explicitly approve the wallet-funded transaction. Wait for confirmation, then resume creation to perform the signature-free factory spend. After confirmed canonical genesis verification, the vault is saved locally and can be opened/shared.

For `P` periods and cap `C` satoshis, the initial state reserve is:

```text
P × C rewards
+ 1,000 state-NFT carrier
+ P × 20,000 future activation/settlement miner fees
+ P × 2,000 future allocation carriers
+ 20,000 existing additional excess/recovery buffer
```

The factory output at pregenesis index 0 holds that reserve plus 11,000: 1,000 pool carrier and exactly 10,000 genesis miner fee. Funding pays another 2,000-satoshi fee and returns separate wallet change (at least 1,000 satoshis). For two periods capped at 2,000, the total committed/spent is 82,000 satoshis, excluding returned change. Wallet funding inputs are token-free; unrelated tokens/NFTs are never fee sources. At most eight inputs are selected.

The factory transaction cannot be combined with genesis: the actual signed parent ID is the unique state category, and genesis must spend its token-free output 0 at input 0. Genesis has exactly two covenant outputs and conserves the factory reserve with its fixed fee.

### Irreversible funding and recovery

RegistryGenesis has **no refund or alternative withdrawal branch**. A valid funded factory can only create the vault with the committed terms. Its identity is the parent transaction ID plus those immutable parameters. Anyone can finish it, and recovery adopts another valid confirmed completion rather than spending a stale factory outpoint. There is no creator refund path for leftover BCH/rewards in the completed Registry either. Do not describe excess reserve as recoverable wallet change.

The mandatory IndexedDB journal (`staking-arena-wallet-v1`) records public operation parameters, selected public derivations, unsigned plan, and validated signed bytes/ID **before** wire submission. Save the public recovery JSON from the operation card. After reload, use Resume; after storage loss, import the parameters and pregenesis ID to reconstruct and verify the factory. Never clear storage before exporting recovery information. If both journal/exported parameters are lost, Electrum cannot recover a hash-committed factory's unknown parameters from an unspent P2SH output. Funds can remain inaccessible; no bypass/refund is added.

## Make an Offer

1. Open an imported/configured, confirmed, open vault with remaining periods and lifetime capacity.
2. Connect the chipnet wallet, check balances and enter valid `S,T,R,W`. Review exact priority `S × T / R` and upfront `S × W` token deposit.
3. If a confirmed, eligible UTXO already holds exactly that fungible amount and 10,000 satoshis, it can directly fund REGISTER. Otherwise explicitly approve preparation. It can consolidate/split selected-category fungible inputs and use token-free BCH sponsors, preserving every token and BCH change output. It never selects NFTs or other categories. Preparation pays 2,000 satoshis; output 0 has exactly 10,000 satoshis and exactly `S × W` units.
4. Wait for preparation confirmation. Continue to a separate REGISTER review and wallet approval. Registration spends canonical state/pool at inputs 0/1, exact prepared escrow at input 2, preserves state BCH and adds the tokens to escrow. Its existing fee is exactly the 10,000-satoshi wallet carrier.
5. Wait for confirmed canonical replay; then the offer appears in the vault's ranking. No win is guaranteed. Each win consumes S, pays BCH immediately, and creates an independent stake allocation whose maturity is based on the winning period's scheduled boundary, not submission/mining time.

The owner's compressed key is the connected wallet's actual receive child 0; P2PKH funding signatures use their own actual derivation paths. Keys remain controlled/derivable by that wallet. The app never manufactures an owner identity or stores a spending key. Owner cancellations/refunds/withdrawal UI remains a separate integration; existing Node support and covenant ownership are preserved.

## Conflicts, journal and tabs

Read-only status checks never request signatures or submit transactions. Resume is an explicit action. An unsigned plan is rebuilt against fresh state before a new wallet approval. After signing, current lineage and all sources are checked again. A competing spend produces a conflict and requires fresh approval when the rebuilt transaction changes. Rejected/lost-acknowledgement submissions keep the exact approved bytes; reconciliation checks both providers before any explicit retry. Reorganized confirmations revert to an error/pending state, and unavailable evidence blocks sending.

Local Web Locks serialize wallet plan reservations/submission. Journal-reserved wallet coins are excluded from another local unsigned operation. A user may discard a truly unsigned plan; prepared token funding remains wallet-owned. Signed/submitted transactions cannot be recalled. Different users/origins can still race; BCH validation decides the spend. Storage denial blocks submission, and wallet disconnect/session change cancels outstanding signing and preserves recovery records.

## Discovery and limits

Created/imported configurations are stored in `arena-chipnet-local-vaults-v1`; the read-only worker restarts with the new configuration and verifies it through the same canonical indexer. Share links carry public genesis/parameters as hints, which another browser must verify on both providers before persisting. Entries are local to that origin/browser, not global marketplace admission. At most 30 local entries are kept alongside configured defaults.

Public Electrum indexes exact scripts/scripthashes, not arbitrary transaction predicates or script prefixes. The factory script varies with all immutable parameters and each registry/pool with its unique category. It therefore cannot provide globally complete discovery of arbitrary new vaults from one fixed query. This phase implements verified local imports/share links rather than silently assuming global visibility or introducing an unreviewed announcement registry. A global announcement protocol/index would be additional infrastructure/design work, even if it added outputs without changing these covenants.

Wallet scanning checks public receive/change/defi branches to a 20-unused-address gap within 40 supplied children per path by default; users may explicitly expand to 200. This is bounded discovery, not proof of full wallet balances. Unconfirmed funds are excluded. Full replay and repeated dual-provider checks add latency. One unavailable/disagreeing required server can prevent spending. Electrum cannot cryptographically prove complete history or non-spending; linked/Merkle-checked server-selected headers are not full PoW/difficulty/cumulative-work validation. Browser suspension/storage eviction and relay/mining policy remain limitations. A funded vault's fixed fee reserve is not a guarantee against future policy changes.

## Verification status

Deterministic protocol/VM coverage and actual wallet results will be recorded in the task verification report. The isolated Cashonize wallet was created through its public UI; seeds were never read/exported. The first user-supplied funding transaction deposited 15,000 chipnet satoshis and no CashTokens. Real end-to-end tests still need the rest of the BCH budget and fungible test tokens at the recorded public test address. Do not publish these flows as verified until actual creation, registration and subsequent browser settlement transactions confirm.

The journal is capped at 64 operations and stops safely at that limit rather than deleting recovery data. Completed/cancelled history export/pruning remains a usability limitation. Cancel is available only for truly unsigned plans; it never claims to recall signed transactions. Full wallet source signatures and outputs are displayed in the wallet, with a short explicit prompt containing the vault/category, deposit, terms and fixed fee.

### Current development WSS endpoints

The development default now uses `wss://chipnet.imaginary.cash:50004` and `wss://electrum-chipnet.optnlabs.com` for the two-host spending checks, with `wss://chipnet.bch.ninja:50004` retained as a third read fallback. Ninja stopped accepting connections during the live test. OPTN advertises its chipnet service at [its infrastructure page](https://www.optnlabs.com/ecosystem); the adapter independently checked protocol 1.5 negotiation, both chipnet header pins, transaction inclusion/linked headers, CashToken NFT decoding and token-aware UTXOs. Different hostnames do not prove independent upstream operators or consensus. All existing verification gates remain mandatory.
