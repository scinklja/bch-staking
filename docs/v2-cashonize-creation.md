# V2 creation for user-operated Cashonize chipnet testing

The unified `#/create` form now defaults to the existing v2 covenant family for
all four asset pairs: BCH/BCH, BCH/CashToken, CashToken/BCH and CashToken/CashToken.
CashToken/BCH also offers the existing v1 protocol explicitly. V1 vault views,
wallet construction and recovery formats remain supported. No covenant source or
compiled covenant artifact changed.

The form requires a usable browser wallet session, a verified balance scan,
valid exact amounts/categories, the required native/token reserve and explicit
funding acknowledgement. Unfinished v2 creation records block starting a second
v2 creation. The existing v2 builder selects confirmed inputs, rejects NFTs and
unrelated tokens, commits the full reward reserve and preserves token change.

Creation proceeds in two separately authorized transactions:

1. The builder saves its unsigned preparation plan. A new pre-approval RPC checks
   its funding layout and confirmed source outputs on two chipnet providers.
   WizardConnect requests Cashonize approval with broadcasting disabled.
2. The returned signed bytes must match the plan, preserve its inputs/outputs,
   pass local BCH VM/signature verification and satisfy the existing fee rules.
   Signed bytes and txid are durably saved before broadcast.
3. Read-only polling reconciles the exact transaction. At least one funding
   confirmation is required before constructing an unsigned v2 genesis plan.
4. The user explicitly chooses **Approve v2 genesis in wallet**, authorizing the
   wallet-owned reward-funding input separately. The same pre-approval and signed
   transaction checks run before genesis broadcast.
5. After genesis confirms, canonical v2 verification succeeds, the public vault
   configuration is saved locally and the app opens the new vault. Pending
   genesis also has a labeled recovery/detail link, without enabling spending of
   unconfirmed sources.

Polling never signs, broadcasts or retries funding. A rejection leaves the
unsigned operation resumable. Uncertain submissions retain the original signed
bytes; only explicit retry controls may rebroadcast identical transactions.
Reloading `#/create` reloads the existing IndexedDB journal and resumes read-only
status checks. Keep the original wallet and browser storage. Public recovery
exports retain parameters, owner derivation, transaction IDs and signed bytes;
there is no new cross-browser journal-import feature.

A recovery correction preserves the original preparation transaction and signed
bytes when inspecting an already completed action. Previously that path could
misclassify confirmed genesis as funding and overwrite its funding metadata.

## Network and signing limits

Mainnet sessions are rejected. Cashonize's current WizardConnect protocol supplies
testnet-family public paths rather than an exact chipnet attestation. The existing
boundary therefore verifies all actual sources against two chain-identified
chipnet providers; a tpub alone is not evidence of chipnet funding. Explicit
conflicting network declarations remain rejected.

Real Cashonize signing has **not** been verified by this change. The validator
requires Schnorr ALL|UTXOS|FORKID (`0x61`) signatures and exact transaction bytes.
Unsupported signatures or changed outputs fail locally. A wallet could accept
preparation but reject the more complex genesis request; factory funds would
remain committed while the operation awaits compatible signing with the original
owner. No validation rule is relaxed to accommodate a wallet response.

Other retained limitations: unaudited experimental code, irreversible factory
funding, no creator refund for unused rewards, raw integer token units without
trusted decimals, 16-period/offer bounds, fixed 10,000-satoshi covenant fees,
external sponsorship for later v2 transitions and local/imported discovery.
Conservative balance previews may require more token-free BCH than the actual
selection needs because token-input carriers can contribute. V2 processing remains
explicitly sponsored; creation does not start an autonomous v2 keeper.

## First Cashonize test

1. Reload the published site and set Cashonize to **chipnet** before connecting
   through WizardConnect. Use test funds only.
2. For a minimal first creation choose BCH staking, BCH rewards, one period and
   `0.00001000 BCH` maximum reward. Choose a future UTC start that allows both
   transactions to confirm. The preview requires `0.00025000 BCH` for this case,
   including the wallet-change allowance; use a wallet with adequate confirmed,
   token-free BCH.
3. Click **Check wallet balances**, review the displayed v2 terms/funding and
   acknowledge them. Choose **Review funding in wallet** and approve only if
   Cashonize shows the expected transaction.
4. Keep the page open or return to `#/create`. Wait for funding confirmation,
   then choose **Approve v2 genesis in wallet** and review the second request.
5. Wait for genesis confirmation and automatic vault navigation. Save the public
   recovery information. On an error, retain the journal and report the exact
   error, operation stage and public txid. Do not create a replacement operation
   merely because acknowledgement is uncertain.

For token rewards, the connected wallet must also contain the full
`maximum reward × periods` fungible reserve in the selected category. Creating a
v2 vault does not require depositing its staking asset.

## Validation for this release

At the user's request, no local regtest, unit, browser end-to-end or real-wallet
tests were executed for this change. Root TypeScript checking and the production
Pages build (including frontend TypeScript) passed. Existing assertions were
updated for the new default protocol and connected-wallet gate but were not run.
No chipnet transaction was initiated by the assistant. Publication is verified by
GitHub Pages build status and HTTP/SHA-256 checks of static assets only.
