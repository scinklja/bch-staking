# Staking Arena v3 caller-funded claim security review

Reviewed branch: `dev/staking-arena-v3`, starting at
`98ea300299cafdf45d16f2bebe3fa029261b0af2` (caller-funded claims).
This is a focused source review with local automated verification, not an
independent audit or a public deployment approval. No chipnet/mainnet deployment
or live Cashonize signing was performed.

## Findings and change

No critical or high-severity fund theft or reward diversion vulnerability was
identified in the reviewed claim covenant, builder and authorization flow.

One missing authorization check was found and hardened: `walletPlanIdentity`
compares transaction bytes, source balances/scripts/tokens, signer mappings and
fees, but intentionally omits WalletConnect request controls and contract
metadata. Consequently a modified persisted claim could retain the same identity
with `broadcast:true`, bypassing the application's validate-and-journal-before-
broadcast ordering in a wallet that honors that flag. Modified source contract
metadata could also reach the wallet. This requires corruption/modification of
local application data; it is not an on-chain reward-diversion exploit.

`AssetWallet.checkClaim` now explicitly requires `broadcast:false`.
`authorize` returns the rebuilt canonical claim plan, including freshly generated
source witnesses and contract descriptions, instead of forwarding saved request
metadata. Existing transaction identity checks remain in place. The existing
four-pair BCHN test now covers the modified broadcast flag and substituted caller
contract metadata. No covenant or architecture change was needed.

## Security conclusions

| Property | Reviewed enforcement and evidence |
| --- | --- |
| Caller debit | Exactly four inputs. Input 3 is token-free BCH. Fixed fee is 10,000 sats; caller additionally supplies 1,000 sats per new token-bearing reward/allocation output. Costs are 10,000 / 11,000 / 12,000 sats for zero / one / two token outputs. Exact protected balances leave no reserve/escrow contribution to fees. |
| Caller change | Five outputs for exact funding, six otherwise. Output 5 must be token-free, at least 1,000 sats, and have exactly input 3's locking bytecode. Conservation and exact fee determine its amount. The builder and saved-plan reconstruction use the selected payer key, including when different from receive child zero. |
| Wallet authorization | Only input 3 is mapped for signing. The bridge verifies live network/session and original receive owner before and after signing. Returned bytes must preserve inputs, outputs, amounts, version, locktime and sequences. Caller signature must be Schnorr `0x61` (ALL + UTXOS + FORKID); script validation verifies it against the actual source. Saved sources are independently checked against confirmed raw transactions and unspent outputs across two providers. |
| Token exclusion | Claim selection excludes every token-bearing caller coin, including fungible tokens, unrelated categories and NFTs. Builder, saved-plan verification, covenant and consensus independently constrain input/output token data. An actual caller NFT remains unspent in BCHN integration coverage. |
| Rejected signatures | Refused/error/missing signing responses never call submit in the browser bridge. Changed transactions or invalid signatures fail before persistence/broadcast. Signed bytes must be durably journaled before send; a failed journal write sends nothing. The rebuilt request explicitly disables wallet broadcast. |
| Winner and exact reward | Registry input 0 compares all active offers using exact cross-products of S, T and R, with earlier-slot tie break. It fixes output 3 to that offer's P2PKH script and exact R in the configured reward asset. No caller-selected recipient or lower-ranked winner is accepted. |
| Protected balances | Inputs 0/1/2 must be sibling outpoints 0/1/2; protected scripts and state commitment are pinned. Outputs 0/1/2 retain the registry carrier, exact remaining stake, exact remaining reserve and required carriers. Role covenants bind the escrow/reserve to the state NFT. |
| Schedule and buffer | Claim requires a full first release interval via CLTV. All input sequences are `0xfffffffe`, preventing a final-sequence locktime bypass. Available reward is released units minus cumulative payments, bounded by reserve. Future locktimes are nonfinal; backdating cannot inflate releases. Builder uses tip MTP minus one. |
| Independent lock | Exactly one output 4 locks S under owner/vault/slot/win-ordinal/asset/CSV terms; win count increases once and escrow decreases by exactly S. Each repeated win has different lock terms. Withdrawals require owner authorization and rounded relative maturity. |
| Competing claims | Every claim spends the same canonical registry, escrow and reserve outpoints. Consensus admits only one conflicting state spend; another claim must use the resulting state and remaining buffer. Broadcast acknowledgement is not confirmation. Reconciliation follows canonical history and retains identical signed bytes after uncertainty. |
| Indexes and policy | Claim input indexes 0–3 and output indexes 0–4, with optional 5, agree across covenant, builder, wallet and replay. Fee summation includes optional change. Actual BCHN `testmempoolaccept`, broadcast/mining, conflicts and CSV withdrawals supplement standalone VM verification. |

Ranking products fit the signed 64-bit arithmetic range under enforced bounds:
S <= 1,000,000, T <= 33,553,920, R <= 16,000,000, so the largest cross-product
is 536,862,720,000,000,000, below 2^63 - 1. State balances are bounded and fit
the four-byte positive encoding. Equal staking/reward categories retain separate
escrow and reserve roles; the existing protocol suite covers this case too.

## Verification

**PASS: `npm run test:review`**, one complete invocation from
2026-11-13 20:36:39 UTC to 21:06:52 UTC, after the final source/test changes.
All nine stages exited zero:

| Stage | Result |
| --- | --- |
| Regtest node | Passed |
| Contracts, typecheck and protocol regressions | 60 regtest tests + 3 offline chipnet configuration/VM tests passed |
| Frontend unit | 74 passed |
| Browser UI | 6 passed |
| Production static | 2 passed |
| Production static smoke | 3 passed |
| Browser indexer | 19 passed |
| V3 browser indexer | 2 passed |
| Production build | Passed; existing large-chunk advisory remains |

The caller-funded BCHN integration test passed in 111.5 seconds, including the
new saved-request checks. Two preliminary runs were stopped during the first
protocol scenario while completing the patch/test setup; their partial results
are not used as passing evidence. The final invocation above completed every
stage without failure. Only essential saved-request regression checks were added
to an existing test. All twenty compiled artifacts were compared with starting
HEAD: only timestamps changed, which were restored; covenant bytecode is unchanged.

Evidence: [complete gate summary and tested source hashes](staking-arena-v3-claim-security-results.json),
[caller-funded transactions](staking-arena-v3-caller-fee-results.json),
[continuous claims, conflicts and locks](staking-arena-v3-results.json), and
[v3 browser replay](staking-arena-v3-browser-results.json).
Full local stage logs remain under `.regtest/review/2026-11-13T20-36-39.645Z/`.
The summary's `sourceCommit` records starting HEAD; its SHA-256 entries identify
the tested wallet and test changes included in this review commit.

With these automated checks passing and no identified critical/high-severity
issue remaining, caller-funded claims are ready for consideration for separately
authorized chipnet testing, subject to the limitations below. This is not real
Cashonize compatibility verification or deployment readiness.

## Remaining risks and boundaries

- **Real Cashonize compatibility is unverified.** Local `SignatureTemplate`
  signatures, mocked WizardConnect responses and real browser workers do not
  establish physical Cashonize support for regtest, `0x61` signing, request
  metadata, prompts, cancellation or transport. A future separately authorized
  wallet/network exercise must verify these before relying on that integration.
- The application and provider remain explicitly regtest-only. Consideration for
  chipnet testing does not authorize removing those guards, deployment, funding,
  or public use. Public-network fee/resource and wallet assessment remain open.
- Two hostnames can reach the same operator/node. Header linkage, raw output and
  inclusion checks do not establish independent chainwork/full consensus,
  complete history, or non-spending against colluding providers. BCHN enforces
  consensus; a compromised application origin or wallet remains outside this
  local-data hardening guarantee and can present unrelated signing requests.
- One confirmed caller BCH coin is supported. It must exactly fund the cost or
  leave at least 1,000 sats change. Fixed fees and bounded wallet scans can cause
  availability failures; no aggregation, consolidation or automatic replacement
  spending is introduced.
- Same-state claims race; a losing signed transaction cannot distribute the same
  reward, but callers may need reconciliation/discard and a new explicit approval.
  Reorgs can undo confirmation and change lock maturity. Journal availability
  and explicit identical-byte recovery remain necessary.
- The sixteen-slot lifetime queue, exact ranking, repeated wins, indefinite head
  blockage, insufficient-final-reserve blockage and potentially stranded rewards
  are preserved. MTP differs from wall time; CSV rounds T upward to 512-second
  units. No administrator recovery, skipping or queue redesign was introduced.
- Existing legacy donation claim code remains for historical reconciliation;
  the browser routes new claims through `AssetWallet.claim`. No new donation
  flow or reimplementation of caller funding is included.
