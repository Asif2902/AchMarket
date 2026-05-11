const hre = require("hardhat");

const EXPECTED_CHAIN_ID = Number(process.env.EXPECTED_CHAIN_ID || 5042002);

async function main() {
  const factoryAddress = process.env.HYBRID_FACTORY_ADDRESS;
  const routerAddress = process.env.MARKET_ROUTER_ADDRESS;
  const orderBookAddress = process.env.ORDER_BOOK_ADDRESS;

  if (!factoryAddress) throw new Error("HYBRID_FACTORY_ADDRESS is required.");
  if (!routerAddress) throw new Error("MARKET_ROUTER_ADDRESS is required.");
  if (!orderBookAddress) throw new Error("ORDER_BOOK_ADDRESS is required.");

  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong network: expected chainId ${EXPECTED_CHAIN_ID}, got ${chainId}.`);
  }

  const provider = hre.ethers.provider;
  for (const [name, address] of [
    ["HYBRID_FACTORY_ADDRESS", factoryAddress],
    ["MARKET_ROUTER_ADDRESS", routerAddress],
    ["ORDER_BOOK_ADDRESS", orderBookAddress],
  ]) {
    const code = await provider.getCode(address);
    if (code === "0x") throw new Error(`No contract code at ${name} ${address}.`);
  }

  console.log("Deploying HybridMarketLens with account:", deployer.address);
  const Lens = await hre.ethers.getContractFactory("HybridMarketLens");
  const lens = await Lens.deploy(factoryAddress, routerAddress, orderBookAddress);
  await lens.waitForDeployment();
  console.log("HybridMarketLens deployed to:", await lens.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
