# Generalized assets v2 — design before implementation

V1 Registry, RegistryGenesis, StakePool and StakeAllocation and their deployed
instances remain immutable. V2 is a separate, opt-in family; no migration or
public deployment is implicit. Existing discovery and wallet flows remain v1.

## Review

V1 uses a 1574-byte hashed state: period, phase, registration count, sixteen
49-byte live offers and a frozen activation roster. Ranking compares S*T*R_other
with bigint integers and breaks ties by first registration. A cancellation after
activation affects future eligibility only; refunds wait until the snapshot has
settled. A winning allocation matures at epoch+(winning period+T)*periodSeconds,
independently of settlement time and other offers. V1 staking escrow is fungible
CashTokens, while BCH rewards and optionally fees live in the state output.
The browser verifies canonical genesis and history through Electrum, persists
pending transactions and revalidates on reorganizations. Wallet construction uses
WizardConnect placeholders and validates the returned transaction and signatures.
V1 bounds are 16 periods/offers, amounts <=1,000,000 and signed four-byte times.
Unused creator rewards have no refund branch. These bounds and that limitation
remain explicit in v2. No additional yield or multiwinner behavior is introduced.

## Versioned assets and conservation

An asset is `{kind:'bch'}` or `{kind:'token',category:<64 hex>}`. Serialized
asset IDs are 32 zero bytes for BCH, or the token category in Script byte order.
The all-zero category is reserved. Immutable constructor assets = stake ID ||
reward ID. State extends v1 with four-byte remaining reward units Q. Initial
Q=cap*periods. All wire/API amounts are raw integer units (satoshis for BCH).
S and BCH R are 1000..1,000,000; token R is 1..1,000,000. Token S retains
the conservative v1 minimum 1000. T,W are 1..periods. Maximum comparison
S*T*R_other <=16,000,000,000,000, within signed 64-bit Script arithmetic.
Priority is the exact rational S*T/R, never a floating point approximation.

Three mandatory paired outputs/inputs have fixed roles:

| Index | Role | Native BCH | Fungible units |
|---|---|---|---|
| 0 | unique mutable state NFT | 1000 | zero |
| 1 | staking escrow | 1000 + (E if BCH) | E if token |
| 2 | reward reserve | 1000 + (Q if BCH) | Q if token |

E=sum S_i*(W_i-wins_i) over unrefunded offers, including cancelled offers.
Distinct role-bound child scripts prevent swapping escrow and reserve even for
the same token category. Nonzero token balances require exactly the configured
fungible category without NFT; zero balances have no token prefix. BCH assets
never have token prefixes. The state category must differ from both token assets.

Registration: E'=E+S*W, Q'=Q. Activation/cancellation/empty advance: E'=E,Q'=Q.
Settlement: E'=E-S,Q'=Q-R; output 3 pays R to the winner, output 4 is a
script-bound independent allocation with S. Refund: E'=E-S*(W-wins), Q'=Q;
output 3 pays precisely that remainder to its signed owner. Allocation withdrawal
returns exactly S to its signed owner after scheduled maturity. Reward Q must
always cover cap*(periods-currentPeriod). Snapshots and canonical ranking retain
v1 rules. Only settlement advances a nonempty period.

## Funding and layouts

Every transition has a mandatory token-free BCH sponsor at the final input,
with no sponsor change; exact fee is 10,000 sats. Registration includes a separate
exact commitment input at index 3; sponsor is index 4, otherwise index 3.
Token registration carriers (1000) are paid into fees; token refund/reward and
allocation outputs each need 1000 sponsor-funded carrier sats. BCH payouts and
allocations contain exactly their principal. The sponsor amount is calculated
from all fixed outputs minus all other inputs plus fee; builders reject any
underfunding, unrelated token, NFT, or oversized fee. The state, escrow, reward
reserve and allocation principal are never fee sources.

Genesis consumes factory output zero (12,000 sats, token free) and an exact
reward funding input (1000 sats carrier plus Q for BCH, or 1000 sats with Q tokens).
It creates the three outputs above and pays 10,000 sats fee. Creator preparation
must preserve all wallet token change. Genesis pins the registry body, empty-state
hash including Q, and both role-bound child scripts. No arbitrary registry or
allocation script can be substituted. Parent and child hashes use the compiled
opcodes, never a supplied template. Fee funding is independent for withdrawal.

## Verification and compatibility plan

Use isolated BCHN regtest funds and deterministic owner keys; mint at least two
finite fungible categories locally. Exercise all four pairs plus same-category
tokens, canonical ties, frozen cancellation, refunds, repeated wins, separate
maturities, invalid outputs/categories/signatures, duplicate/competing spends,
and policy/resource measurements. Keep chipnet as a separate compatibility target.
Browser discovery must verify genesis, all three paired outputs, full history and
active-chain evidence before enabling actions; pending spends must be reconciled
and reorged histories discarded. Wallet signing must check the actual capability
and validate signed bytes locally. Local VM/BCHN success does not establish real
WizardConnect or public-chipnet compatibility. No mainnet or website deployment.

References: CashScript [token introspection and burn handling](https://cashscript.org/docs/design/cashtokens),
[covenants](https://cashscript.org/docs/design/covenants), and
[VM resource measurements](https://cashscript.org/docs/design/optimization).

## Implemented files and local use

Run `npm run node:start`, then `npm run test:v2`. `npm test` compiles both
families and runs all reference regressions; chipnet tests remain a separate
network group. The shared browser/Node builder is `src/v2/protocol.ts`.
`AssetIndexer` in `src/v2/indexer.ts` replays three-output lineage, validates
transactions in the BCH VM, proves confirmed transactions, links headers and
requires agreement between two distinct Electrum hosts. Each sync replaces the
entire snapshot. Provider failure clears the trusted snapshot. Incoming donations
are not mistaken for canonical state transitions. Pending spends do not change
confirmed balances, and block further actions against the affected state.

`src/v2/wallet.ts` prepares wallet-authorized funding and uses a second approval
only after funding confirms. Token change gets its own 1000-sat output and BCH
change is separate so future fee sponsors remain available. All source coins are
verified on both providers before signing/submission; signed transactions are
checked against the approved template and executed locally. Signed bytes and txid
are durably stored before broadcast. Missing acknowledgement retains the same
signed bytes. Resume reconciles confirmations, rebuilds unsigned action plans from
fresh state, and never silently replaces a signed transaction. Explicit retry
rebroadcasts identical bytes after checking that sources remain unspent.

The browser's `#/v2` page is opt-in and separate from deployed v1 vault views.
It supports both asset selectors, raw-unit funding quotes, wallet balance scans,
exact rational priorities, canonical genesis import, sponsored period processing,
cancellation/refunds, independent maturity/withdrawal, and public recovery records.
Public configurations carry `version:2` and decimal string caps when exported;
the internal API uses bigint. Discovery is local/imported, not a global listing.
The keeper decision and transition builder are portable and permissionless; each
transition still needs an external sponsor. No background process, API or hosted
keeper is required.

## Explicit limitations and security review requirements

This is development code, not an audited release. No mainnet deployment, v1
migration or replacement of the chipnet website is authorized or performed.
V1 scripts and bytecode must remain identical. There is no creator refund branch
for unused rewards or factory BCH. The 16 lifetime offer/period bounds and raw
amount limits deliberately remain conservative. Amount decimal metadata is not
trusted or inferred. An owner must retain the original signing wallet.

CashScript token introspection cannot distinguish a fungible-only prefix from an
immutable NFT with an empty commitment in the same category. Wallet selection and
indexed canonical sources reject *all* NFTs in asset roles, and no canonical
transaction introduces one. An owner deliberately funding a raw, non-client
factory transaction with such an NFT can burn their own NFT; the covenant still
preserves exact fungible and BCH principal. Do not claim a general NFT-preservation
proof for arbitrary externally constructed transactions. NFTs with nonempty
commitments or mutable/minting capability fail the asset role checks.

Electrum verification uses merkle proofs, linked headers and agreement of distinct
hosts, retaining the existing light-client trust model; it is not independent PoW
chain selection. Imported v2 genesis must pass canonical factory/VM validation.
UTXO races after approval can invalidate a plan; they cannot release protected
funds. A discarded unsigned funding plan releases local reservations; already
prepared wallet funds remain controlled by the wallet. Browser journals are
public transaction recovery data, not key backups; exporting metadata does not
replace preserving signed transactions or the original wallet.

Before public chipnet rollout: independently review all covenant branches,
reproduce standard-policy/resource results on the intended BCHN release, test
real WizardConnect funding, genesis, registrations and withdrawals, confirm
actual wallet support for Schnorr ALL|UTXOS signing of these contract layouts,
and verify recovery/reorg behavior on the public providers. A supported signing
method is checked before requesting approval, and incompatible returned signatures
are rejected locally. Local simulated-wallet success is not real-wallet evidence.
