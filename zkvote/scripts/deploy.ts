import { ethers, network, run } from "hardhat"
import { writeFileSync } from "fs"

// Semaphore v4 on Sepolia. Confirm against the Semaphore docs before relying on it.
const SEPOLIA_SEMAPHORE = "0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D"

async function main() {
  let semaphore = process.env.SEMAPHORE_ADDRESS || (network.name === "sepolia" ? SEPOLIA_SEMAPHORE : "")
  if (!semaphore) {
    const deployed = await run("deploy:semaphore", { logs: false })
    semaphore = await deployed.semaphore.getAddress()
  }
  const zk = await (await ethers.getContractFactory("ZKVote")).deploy(semaphore)
  const receipt = await zk.deploymentTransaction()!.wait(network.name === "hardhat" || network.name === "localhost" ? 1 : 5)
  const address = await zk.getAddress()
  const chainId = (await ethers.provider.getNetwork()).chainId
  const env = `VITE_ZKVOTE_ADDRESS=${address}\nVITE_DEPLOY_BLOCK=${receipt!.blockNumber}\nVITE_CHAIN_ID=${chainId}\n`
  writeFileSync("web/.env.local", env)
  console.log(`ZKVote ${address} (Semaphore ${semaphore}) on chain ${chainId}; wrote web/.env.local`)
  console.log(`\nSet these in Vercel (Project Settings > Environment Variables):\n${env}`)
  if (network.name === "sepolia" && process.env.ETHERSCAN_API_KEY) {
    try { await run("verify:verify", { address, constructorArguments: [semaphore] }); console.log("Verified on Etherscan") }
    catch (e: any) { console.log("Etherscan verification skipped:", e.shortMessage || e.message) }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
