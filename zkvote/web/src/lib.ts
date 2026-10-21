import { BrowserProvider, Contract, EventLog, Log, isAddress } from "ethers"
import { Identity } from "@semaphore-protocol/identity"
import { Group } from "@semaphore-protocol/group"
import { generateProof } from "@semaphore-protocol/proof"
import { ABI } from "./abi"

export const ADDRESS = (import.meta.env.VITE_ZKVOTE_ADDRESS ?? "") as string
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111)
const DEPLOY_BLOCK = Number(import.meta.env.VITE_DEPLOY_BLOCK ?? 0)

const CHAINS: Record<number, { name: string; add?: object }> = {
  11155111: { name: "Sepolia" },
  31337: {
    name: "Local Hardhat",
    add: {
      chainId: "0x7a69", chainName: "Hardhat Local", rpcUrls: ["http://127.0.0.1:8545"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
    }
  }
}
export const CHAIN_NAME = CHAINS[CHAIN_ID]?.name ?? `chain ${CHAIN_ID}`

export type Ctx = { account: string; contract: Contract; provider: BrowserProvider }
export type Proposal = {
  id: number; title: string; description: string; options: string[]; registrationEnd: number
  votingEnd: number; groupId: bigint; voters: number; restricted: boolean; tally: number[]; joined: boolean
}

export const phase = (p: Proposal) => {
  const t = Date.now() / 1000
  return t < p.registrationEnd ? "registration" : t < p.votingEnd ? "voting" : "closed"
}

export async function connect(): Promise<Ctx> {
  const eth = (window as any).ethereum
  if (!eth) throw new Error("Install MetaMask to continue.")
  if (!isAddress(ADDRESS)) throw new Error("VITE_ZKVOTE_ADDRESS is missing or invalid. Deploy the contract, set it, and rebuild.")
  if (CHAIN_ID !== 31337 && DEPLOY_BLOCK === 0)
    throw new Error("VITE_DEPLOY_BLOCK is not set. Use the block number of the ZKVote deployment, then rebuild.")
  await eth.request({ method: "eth_requestAccounts" })
  const hex = "0x" + CHAIN_ID.toString(16)
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] })
  } catch (e: any) {
    const add = CHAINS[CHAIN_ID]?.add
    if (e?.code === 4902 && add) await eth.request({ method: "wallet_addEthereumChain", params: [add] })
    else throw new Error(`Switch your wallet to ${CHAIN_NAME}, then connect again.`)
  }
  eth.on?.("accountsChanged", () => location.reload())
  eth.on?.("chainChanged", () => location.reload())
  const provider = new BrowserProvider(eth)
  const signer = await provider.getSigner()
  return { account: await signer.getAddress(), provider, contract: new Contract(ADDRESS, ABI, signer) }
}

export async function loadProposals(c: Ctx): Promise<Proposal[]> {
  const n = Number(await c.contract.proposalCount())
  const rows = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const [p, joined] = await Promise.all([c.contract.getProposal(i), c.contract.registered(i, c.account)])
    return {
      id: i, title: p.title, description: p.description, options: [...p.options] as string[],
      registrationEnd: Number(p.registrationEnd), votingEnd: Number(p.votingEnd), groupId: p.groupId as bigint,
      voters: Number(p.voters), restricted: p.restricted, tally: [...p.tally].map(Number), joined
    }
  }))
  return rows.reverse()
}

export async function createProposal(c: Ctx, title: string, desc: string, options: string[], reg: number, vote: number, allow: string[]) {
  const bad = allow.find((a) => !isAddress(a))
  if (bad) throw new Error(`"${bad}" is not a valid wallet address.`)
  await (await c.contract.createProposal(title, desc, options, reg, vote, allow)).wait()
}

const sk = (c: Ctx, id: number) => `zkvote:${ADDRESS}:${id}:${c.account}`
export const savedKey = (c: Ctx, id: number) => {
  try { return localStorage.getItem(sk(c, id)) } catch { return null }
}

export async function register(c: Ctx, p: Proposal) {
  const existing = savedKey(c, p.id)
  const identity = existing ? Identity.import(existing) : new Identity()
  // Saved before sending so the key survives a closed tab; removed again if the transaction fails.
  if (!existing) localStorage.setItem(sk(c, p.id), identity.export())
  try {
    await (await c.contract.register(p.id, identity.commitment)).wait()
  } catch (e) {
    if (!existing) localStorage.removeItem(sk(c, p.id))
    throw e
  }
}

/** getLogs in block chunks, shrinking the window when an RPC rejects a wide range. */
async function logs(c: Ctx, filter: any): Promise<(EventLog | Log)[]> {
  const latest = await c.provider.getBlockNumber()
  const out: (EventLog | Log)[] = []
  let from = DEPLOY_BLOCK, step = 50_000
  while (from <= latest) {
    const to = Math.min(from + step - 1, latest)
    try { out.push(...(await c.contract.queryFilter(filter, from, to))); from = to + 1 }
    catch (e) { if (step <= 500) throw e; step = Math.floor(step / 4) }
  }
  return out
}

async function commitments(c: Ctx, id: number) {
  return (await logs(c, c.contract.filters.Registered(id))).map((l) => BigInt((l as EventLog).args[1]))
}

export async function castVote(c: Ctx, p: Proposal, choice: number, pasted: string) {
  const key = pasted.trim() || savedKey(c, p.id)
  if (!key) throw new Error("No voting key. Paste the key you saved when you registered.")
  let identity: Identity
  try { identity = Identity.import(key) } catch { throw new Error("That does not look like a valid voting key.") }
  const members = await commitments(c, p.id)
  if (!members.includes(identity.commitment)) throw new Error("This key is not in the voter group for this proposal.")
  const proof = await generateProof(identity, new Group(members), choice, p.groupId)
  await (await c.contract.castVote(p.id, choice, proof)).wait()
}

/** Recounts ballots from VoteCast events, ignoring repeated nullifiers, and compares with the stored tally. */
export async function verify(c: Ctx, p: Proposal) {
  const seen = new Set<string>(); const counts = p.options.map(() => 0)
  for (const l of await logs(c, c.contract.filters.VoteCast(p.id))) {
    const [, nullifier, choice] = (l as EventLog).args
    if (seen.has(nullifier.toString())) continue
    seen.add(nullifier.toString()); counts[Number(choice)]++
  }
  return { ballots: seen.size, ok: counts.every((n, i) => n === p.tally[i]) }
}
