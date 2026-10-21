# ZKVote

Anonymous on-chain voting. Solidity + Semaphore v4 (zero-knowledge group membership and nullifiers), Hardhat, React + TypeScript (Vite), MetaMask, Sepolia, Vercel.

## How it works
1. `createProposal` makes a proposal and its own Semaphore group. Windows: registration, then voting.
2. `register(id, commitment)`: one per wallet (optional allowlist). Only the identity commitment enters the group.
3. `castVote(id, choice, proof)`: a Groth16 proof shows membership, binds the choice (`message`) and the proposal (`scope = groupId`). Semaphore's nullifier is stored per group, so a second ballot from the same identity reverts.
4. Results: `tally` on chain, plus a client-side recount from `VoteCast` events (distinct nullifiers).

## Run
```bash
npm install && (cd web && npm install)
npm test                      # downloads Semaphore proving artifacts on first run
npx hardhat node              # terminal 1
npm run deploy:local          # terminal 2 (writes web/.env.local)
npm run web
```

## Deploy to Sepolia and Vercel
1. **Contract.** `cp .env.example .env`, fill `SEPOLIA_RPC_URL`, a funded `PRIVATE_KEY` (use a throwaway key) and optionally `ETHERSCAN_API_KEY`, then `npm run deploy:sepolia`. It uses the public Semaphore v4 deployment unless `SEMAPHORE_ADDRESS` is set, waits for 5 confirmations, verifies on Etherscan when a key is present, and prints the three values the frontend needs.
2. **Frontend.** Push the repo to GitHub and import it in Vercel. Leave the Root Directory at the repo root: `vercel.json` installs and builds `web/` and serves `web/dist` (SPA rewrite, immutable asset caching, basic security headers).
3. **Environment variables** (Project Settings, then Environment Variables, all environments):
   - `VITE_ZKVOTE_ADDRESS` deployed ZKVote address
   - `VITE_DEPLOY_BLOCK` block of the deployment transaction (required on Sepolia; event scans start here)
   - `VITE_CHAIN_ID` `11155111`
4. Redeploy after changing variables; Vite inlines them at build time.

Local check of the production build: `cd web && cp .env.example .env.local` (fill it), `npm install && npm run build && npm run preview`. `npm run typecheck` in `web/` runs `tsc` separately so type errors never block a deploy.

Notes: first proof generation downloads Semaphore proving artifacts from the browser, so allow a few seconds. Use a wallet RPC that permits `eth_getLogs` (MetaMask's default does); the app chunks log queries and shrinks the window if an RPC refuses a wide range.

## Privacy model and limits
- Ballots are unlinkable to identities, but each choice is public and the tally is live. This is anonymous voting, not sealed-until-close voting.
- Registration is public by wallet. If the same wallet registers and votes, an observer can match the transactions. Register with one wallet, then vote from another funded wallet (paste the voting key), or add a relayer.
- The voting key lives in browser localStorage. Losing it means losing the ballot; leaking it lets someone else vote.
- One registration per wallet is Sybil resistance only as strong as your allowlist.
- Unaudited. Confirm the Semaphore address in `scripts/deploy.ts` against the Semaphore docs.

## Using the app
1. Open the site, click **Connect MetaMask** (it will offer to switch to Sepolia; get test ETH from a Sepolia faucet).
2. **Write a proposal**: title, 2 to 8 options, a sign-up window and a voting window (use the 5m/1h/1d chips), optionally an allowlist of wallets.
3. During sign-up, anyone eligible clicks **Register to vote**. Click **Copy voting key** and store it somewhere safe.
4. When voting opens, pick an option. For real anonymity switch MetaMask to a different funded wallet and paste the key, then **Cast ballot** (the proof takes a few seconds).
5. Anyone can press **Recount from chain events** to check the tally against the VoteCast logs.
