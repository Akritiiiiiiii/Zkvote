import { expect } from "chai"
import { ethers, run } from "hardhat"
import { time } from "@nomicfoundation/hardhat-network-helpers"
import { Identity } from "@semaphore-protocol/identity"
import { Group } from "@semaphore-protocol/group"
import { generateProof } from "@semaphore-protocol/proof"

describe("ZKVote", function () {
  this.timeout(300_000)
  let zk: any, s: any[], ida: Identity, idb: Identity, group: Group, groupId: bigint

  async function deploy(allowlist: string[] = []) {
    const { semaphore } = await run("deploy:semaphore", { logs: false })
    zk = await (await ethers.getContractFactory("ZKVote")).deploy(await semaphore.getAddress())
    s = await ethers.getSigners()
    await zk.createProposal("Fund the library", "Q4 grant", ["Yes", "No"], 120, 3600, allowlist)
    groupId = (await zk.getProposal(0)).groupId
  }
  async function registerTwo() {
    ida = new Identity(); idb = new Identity()
    await zk.connect(s[1]).register(0, ida.commitment)
    await zk.connect(s[2]).register(0, idb.commitment)
    group = new Group([ida.commitment, idb.commitment])
  }

  it("creates proposals with a Semaphore group", async () => {
    await deploy()
    expect((await zk.getProposal(0)).options).to.deep.equal(["Yes", "No"])
    expect(await zk.proposalCount()).to.equal(1)
    await expect(zk.createProposal("x", "", ["only"], 120, 120, [])).to.be.revertedWith("2 to 8 options")
  })

  it("limits registration to one per wallet, inside the window, and honours allowlists", async () => {
    await deploy([(await ethers.getSigners())[1].address])
    const id = new Identity()
    await expect(zk.connect(s[2]).register(0, id.commitment)).to.be.revertedWith("wallet not allowlisted")
    await zk.connect(s[1]).register(0, id.commitment)
    await expect(zk.connect(s[1]).register(0, new Identity().commitment)).to.be.revertedWith("already registered")
    await time.increase(121)
    await expect(zk.connect(s[1]).register(0, id.commitment)).to.be.revertedWith("registration closed")
  })

  it("counts an anonymous ballot cast from an unrelated wallet", async () => {
    await deploy(); await registerTwo()
    await time.increase(121)
    const proof = await generateProof(ida, group, 0, groupId)
    await expect(zk.connect(s[5]).castVote(0, 0, proof)).to.emit(zk, "VoteCast").withArgs(0, proof.nullifier, 0)
    expect((await zk.getProposal(0)).tally.map(Number)).to.deep.equal([1, 0])
    expect(BigInt(proof.nullifier)).to.not.equal(ida.commitment)
  })

  it("blocks a second ballot from the same identity, even for another option", async () => {
    await deploy(); await registerTwo()
    await time.increase(121)
    await zk.castVote(0, 0, await generateProof(ida, group, 0, groupId))
    await expect(zk.castVote(0, 1, await generateProof(ida, group, 1, groupId))).to.be.reverted
    expect((await zk.getProposal(0)).tally.map(Number)).to.deep.equal([1, 0])
  })

  it("rejects proofs from identities outside the registered group", async () => {
    await deploy(); await registerTwo()
    const outsider = new Identity()
    const forged = new Group([ida.commitment, idb.commitment, outsider.commitment])
    await time.increase(121)
    await expect(zk.castVote(0, 0, await generateProof(outsider, forged, 0, groupId))).to.be.reverted
  })

  it("enforces the voting window, option range and proof/choice binding", async () => {
    await deploy(); await registerTwo()
    const proof = await generateProof(ida, group, 0, groupId)
    await expect(zk.castVote(0, 0, proof)).to.be.revertedWith("voting not started")
    await time.increase(121)
    await expect(zk.castVote(0, 7, proof)).to.be.revertedWith("invalid option")
    await expect(zk.castVote(0, 1, proof)).to.be.revertedWith("proof is for another option")
    await zk.castVote(0, 0, proof)
    await time.increase(3601)
    await expect(zk.castVote(0, 0, await generateProof(idb, group, 0, groupId))).to.be.revertedWith("voting closed")
  })
})
