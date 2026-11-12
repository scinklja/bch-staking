# Experimental chipnet wallet release — 2026-11-12

The user explicitly authorized publication without further tests and requested experimental labels. This supersedes the earlier requirement to wait for a complete real-wallet creation/registration/settlement exercise before publication. It does **not** establish that those workflows passed live verification.

Production URL: https://scinklja.github.io/staking-arena-site/

Create Vault and Make an Offer display prominent **EXPERIMENTAL** notices on the marketplace and their respective forms, explaining that the real-wallet end-to-end flow is unverified, only chipnet test funds may be used, and committed BCH has no creator refund. Wallet spending still requires explicit approval. Existing transaction, covenant and provider checks remain in place.

The release uses public chipnet WSS, no Node API/RPC, the `/staking-arena-site/` base, and automatic settlement defaults to disabled. Mainnet remains disabled. No covenants or compiled covenant bytecode changed. Contract source/debug metadata is removed from browser build artifacts; bytecode, ABI, constructor inputs and compiler metadata remain intact. No source maps, private source tree, runtime data, wallet profiles or credentials are copied to the public repository.

No additional test suites or live wallet spending were performed for this release, per the user's instruction. Production compilation was run to build the labels and compiled-only artifact packaging. Previous results are in [wallet verification](browser-wallet-verification.md); they do not prove the complete real-wallet workflow, and they predate the release's label/packaging changes. Final publication checks are limited to GitHub Pages deployment status and HTTP delivery of the compiled release, not functional retesting.

## Rollback

Previous production commit: `4c420d6c7cc555c44c39ef6badc8f4fe73f0a0c3`.

Preserved public branch: `rollback/pre-experimental-wallet-2026-11-12` in `scinklja/staking-arena-site`.

To roll back without rewriting history, in a clean checkout of the **public compiled repository**:

```sh
git switch main
git pull --ff-only
git restore --source=rollback/pre-experimental-wallet-2026-11-12 --staged --worktree -- .
git commit -m "Restore pre-experimental chipnet frontend"
git push origin main
```

GitHub Pages publishes `main` from `/`. Do not copy the private source repository into this public checkout.

## Publication record

Source and public commit IDs and delivery status are appended after publication.
