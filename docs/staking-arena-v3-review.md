# Staking Arena v3 review

Reviewed from `57f742b` on `dev/staking-arena-v3`. This is a local development
review, not an independent security audit or deployment approval. Existing hosting
templates and sanitized legacy wallet/chipnet evidence were committed separately;
those files describe historical work and do not imply v3 has been deployed.

## Architecture findings

| Area | Finding and enforcement | Decision or limitation |
|---|---|---|
| Buffer | Total funding is fixed at genesis. Released = min(releases, floor((locktime-start)/interval))*releaseAmount. Available = released - cumulativePaid, limited by remaining reserve. Claim subtracts exactly R from reserve; non-claim operations cannot replenish it. | First release follows a complete interval. No release transaction is needed. |
| Timing | Claim executes CLTV and all transition sequences are 0xfffffffe, so future locktime cannot be bypassed with final sequences. Builders use tip MTP minus one. Release boundaries are strictly below MTP when usable. | UTC wall time is informational. MTP can lag it. |
| Head selection | The covenant compares S*T*other.R and other.S*other.T*R across all active records. Earlier slot wins exact ties. Eligibility excludes only cancellation, refund or completed W; insufficient R never removes the head. | Same fixed array, sixteen lifetime registrations, serialized state NFT. No queue redesign. |
| Repeated wins | Each claim increments wins by one, removes exactly S from escrow, and creates a distinct allocation binding owner, vault, slot, win ordinal, S, asset and CSV sequence. | At most W wins, W <= 16. Cancellation refunds only unused commitments. |
| Locks | Exact sequence is time flag + ceil(T/512), with transaction version 2. Maturity uses MTP of the block before the claim's confirmation block. | Requested T determines agreed priority. Effective duration can be up to 511 seconds greater. Queue, preview and allocations display effective lock duration; maturity is shown in UTC MTP. |
| Insufficient reserve | Once R > remaining reserve, that offer can never be paid, regardless of future releases. It continues blocking claims while ranked first. | Voluntary cancellation or a new legitimately higher-ranked affordable offer can change the head if capacity remains. No forced skipping/deletion. |
| Stranded rewards | Sixteen lifetime offers and W <= 16 allow at most 256 wins. Exhausted capacity, insufficient final buffer or a blocked/lost-key head can leave reserves unused. | No creator sweep, replenishment or admin recovery. Do not change this family to add one without a separate decision. |
| Sponsorship | Vault-specific FeeSponsorV3 can only occupy input 3 alongside its registry in a valid four-input, five-output claim. Registry fixes all payouts and exactly 10,000-sat fees; extra token carriers also come from sponsorship. | Donations are irrevocable and require exact amounts. UI verifies confirmed sponsorship on both peers before enabling claims. |
| Competing claims | State NFT, escrow and reserve must spend canonical sibling outpoints. Same-state claims double-spend each other; each valid transition commits exact remaining balances. | Provider/chain changes cause refresh or rejection; BCH consensus ultimately resolves races. |
| Confirmation and recovery | Signed bytes and claim intent are journaled before broadcast. Broadcast is pending, not confirmed. Canonical replay determines confirmation and recomputes locks after reorgs. | Added worker-ready handshake after browser reload exposed a lost initialization request. Startup/request timeouts now give recoverable errors. |

The v3 review fixes are frontend/worker/test changes. V1/v2 and v3 covenant bytecode
are unchanged. Signed-plan validation still checks exact inputs, outputs, sequences,
assets, Schnorr authorization and fees. Existing v1/v2 entry points, wallet journals,
period activation/snapshots/settlement and allocation semantics remain separate.

## Timing references

[BIP68](https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki) defines the
512-second units and the previous-block MTP anchor for relative time locks.
[BIP113](https://github.com/bitcoin/bips/blob/master/bip-0113.mediawiki) defines the
MTP comparison for absolute finality. Local BCHN integration tests verify the
actual locktime and sequence behavior; a standalone script VM cannot establish
input age or select the canonical chain.

## Decisions still required before public deployment

1. Accept ranking by requested T with effective locks rounded to 512-second units,
   or explicitly specify a future version restricting T to those units. Current
   ranking is preserved; values 513 and 1023 both lock for 1024 MTP seconds.
2. Accept indefinite head blockage and stranded rewards under the existing queue,
   or design a separately reviewed future recovery/expiry policy. No recovery
   authority or new queue structure has been introduced.
3. Accept the inherited fixed fee and irrevocable sponsorship model, or specify a
   future fee/refund policy. Excess or wrongly sized donations may remain unusable.
4. Establish real wallet support for the intended network. Local signing tests and
   mocked wallet transport do not certify physical Cashonize regtest support.
5. Select and independently review a public chain-verification/indexing strategy.
   The browser checks hashes, inclusion, linked headers and provider agreement;
   it does not prove complete history, non-spending, full consensus or chainwork.
6. Perform independent covenant/security review, production fee/resource assessment,
   and obtain explicit approval for any chipnet or mainnet deployment.

## Complete review gate

Run `npm run test:review`. It starts/checks local BCHN regtest and compiles all covenant
families and runs all v1/v2/v3 protocol tests, frontend unit tests, browser UI,
production static tests and smoke checks, Electrum indexer/wallet/settlement browser
tests, v3 browser worker tests, and the production build. Every stage must pass in
one invocation; failure stops the run. After any fix, rerun the entire command.
Logs and stage results are saved under `.regtest/review/`.

Browser v3 tests use real compiled covenants and the production worker over local
TLS WebSockets with synthetic linked headers/Merkle proofs. Separate tests use
actual BCHN regtest for transaction admission, maturity, conflicts and reorganizations.
No live chipnet tests, external wallet signing or deployment is part of this gate.
The opt-in development-supervisor test requires stopping existing services and is
outside the protocol/browser review gate.


## Full-run infrastructure correction

The first fresh review gate exposed an actual node-restart failure in the v1
keeper/indexer test. The shared regtest chain had blocks more than two hours beyond
wall time from deliberate mocktime mining. BCHN rejected that tip during startup,
leaving its RPC cookie absent and causing the following node tests to fail too.
The regtest node script now saves its verified tip time atomically before shutdown
and resumes the saved test clock only when needed to load a future-dated tip.
Normal wall-clock starts are unchanged. The existing chain and wallet were recovered
without reindexing or deletion. The real stop/start regression is retained, and the
complete gate is rerun after the correction. No chipnet startup script was changed.
