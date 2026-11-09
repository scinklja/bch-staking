# Staking Arena v0.2.0-regtest security-review checklist

This is a regtest checkpoint, not an audit sign-off or production recommendation. Checked items describe integration evidence within its stated scope; unchecked items require further review or operational work. See [registry architecture and measurements](registry.md) and the checkpoint verification log for exact results.

## Covenant fund conservation

- [x] Exercise exact stake-category and amount equations before/after registration, settlement and remainder refund; preserve independent allocation ownership, ranking, immutable snapshots and fixed UTC maturity.
- [x] Exercise exact native-BCH reward, state reserve, pool carrier, allocation carrier and withdrawal-output constraints; reject underpayment, surplus outputs and attempted theft.
- [ ] Independently review all action/state combinations, flag interactions, integer encodings and arithmetic boundaries. Selected maximum-bound cases are not exhaustive or a formal proof.
- [ ] Review external staking-asset issuance and retained minting authority. Category binding does not establish scarcity; rewards are native BCH, not reward CashTokens.

## External fee sponsorship

- [x] Exercise one optional token-free input for registration, activation, settlement, cancellation, refund and independent withdrawal, including zero prepaid fee reserve and a 1,000-satoshi registration token carrier.
- [x] Use distinct initial-funder, stake-owner and sponsor keys; reject token-bearing sponsors, extra inputs/outputs and stolen destinations. Insufficient fees receive a policy rejection.
- [ ] Review transaction assembly and signature coverage, including alternate SIGHASH modes, arbitrary funding-script types, input permutations and fee estimation. The tests use deterministic signed P2SH funding fixtures.
- [ ] Establish sponsor discovery and sustainable funding incentives. Sponsorship is voluntary; its single input receives no change and excess BCH becomes miner fee. Required owner signatures remain required.

## Genesis uniqueness and authority

- [x] Exercise the pinned factory: input 0/index 0, distinct state/staking categories, one mutable non-minting state NFT, zero state fungible amount, empty authenticated state/pool and immutable registry/pool scripts.
- [x] Reject malformed/underfunded creation, minting authority and substituted parameters; require exact genesis value conservation and N×C+1,000 reward reserve. Confirmed admission reconstructs the actual factory lineage.
- [ ] Independently review CashTokens genesis authorization, constructor serialization across all valid parameter encodings and proof/version pinning. A factory proof identifies one instance; it cannot prohibit unrelated lookalikes globally.
- [ ] Build external-chain admission/indexing and reorg recovery. The supplied verifier is a local regtest RPC adapter and checks confirmation at the time of admission.

## Adversarial transaction construction

- [x] Use real BCHN testmempoolaccept on unspent inputs, bypassing SDK guards where needed, with explicit script, token-conservation, locktime and policy rejection classes.
- [x] Exercise replay, unauthorized withdrawal, forged allocation metadata, omitted/changed snapshots, score ties, capacity overflow and stake reuse attacks.
- [ ] Fuzz raw transactions and state witnesses; cover nonminimal/alternative encodings, signatures, NFT edge cases, transaction ordering and simultaneous conflicting spends.
- [ ] Test malicious transactions in handcrafted blocks and compare consensus behavior across implementations. Mempool rejection is not an independent invalid-block experiment; accepted confirmed transactions provide positive consensus evidence only.

## Keeper liveness

- [x] Exercise permissionless activation/settlement without creator authorization, serial catch-up, late settlement/withdrawal and independent withdrawal during an unrelated activated period.
- [ ] Provide durable state-witness storage, an indexer, restart/reorg recovery, competing keepers and monitoring. No automatic keeper or sponsor service is supplied.
- [ ] Test sustained contention, missing witnesses, censorship and realistic timing. Median-time-past and miner inclusion cannot guarantee execution at an exact UTC wall-clock boundary. An activated period blocks unallocated refunds until settlement/empty advancement.

## Public-network relay compatibility

- [x] Exercise BCHN 29.2.0 with acceptnonstdtxn=0 on two non-whitelisted loopback nodes; observe peer mempool arrival before mining and confirmation on both nodes.
- [x] Check standardness enforcement with oversized OP_RETURN rejection and a smaller relayed/confirmed control; measure transaction/script sizes, fees and maximum-bound 16-offer settlement resource usage.
- [ ] Test actual public-network peers, multiple versions/implementations and miner policies, dynamic fee floors and long unconfirmed chains. Local standard-policy compatibility does not establish universal public relay or inclusion.
- [ ] Measure production announcement latency and peak stack occupancy. Local inventory announcements use 100 ms for test speed; SDK cumulative pushed bytes are not peak stack usage. No capacity above 16 or horizon above 16 is supported or established.

## Recovery of stranded funds

- [x] Demonstrate fee/carrier recovery with external BCH without changing stake ownership, rewards, state-transition semantics or allocation maturity; preserve independent owner-authorized withdrawals.
- [ ] Review operational handling of missing reward backing, lost owner keys, unavailable witnesses and stalled keepers. Fee sponsorship cannot reconstruct rewards or signatures, and does not itself restore lost witnesses.
- [ ] Address incorrectly funded factory outputs: creation requires sole-input prefunding at index 0, sufficient BCH and a fixed 10,000-satoshi genesis fee. Nonzero-index/underfunded prefunding has no tested rescue path in this factory.
- [ ] Decide whether a future protocol needs surplus-reserve recovery or an explicitly designed upgrade/migration path. Current covenants have no general top-up, reserve-sweep or privileged rescue; old deployments cannot acquire new bytecode rules. These limitations are not solved by the integration tests.

## Publication hygiene

- [x] Record the fresh checkpoint run, confirm the original chain checkpoint remains an ancestor, and verify covenant source hashes did not change during checkpoint preparation.
- [x] Review staged paths and content for wallet files, cookies, environment files, credentials and private key material. Deterministic regtest fixture keys are intentionally public and must never secure real funds.
- [ ] Independently verify that published master and the annotated milestone tag resolve to this checkpoint before relying on the release; check the working tree before resuming work.
