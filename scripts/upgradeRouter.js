import hre from "hardhat";

const EXPECTED_CHAIN_ID = Number(process.env.EXPECTED_CHAIN_ID || 5042002);
const CHUNK_SIZE_WAD = process.env.ROUTER_CHUNK_SIZE_WAD || "50000000000000000000";
const MAX_TRADE_SHARES_WAD = process.env.ROUTER_MAX_TRADE_SHARES_WAD || "10000000000000000000000";
const DEFAULT_MAX_HOPS = process.env.ROUTER_DEFAULT_MAX_HOPS || "64";

async function main() {
  const { ethers } = await hre.network.connect();
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account configured. Set DEPLOYER_PRIVATE_KEY.");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong network: expected chainId ${EXPECTED_CHAIN_ID}, got ${chainId}.`);
  }

  const factoryAddress = process.env.HYBRID_FACTORY_ADDRESS;
  const orderBookAddress = process.env.ORDER_BOOK_ADDRESS;
  const oldRouterAddress = process.env.MARKET_ROUTER_ADDRESS;
  if (!factoryAddress) throw new Error("HYBRID_FACTORY_ADDRESS is required.");
  if (!orderBookAddress) throw new Error("ORDER_BOOK_ADDRESS is required.");
  if (!oldRouterAddress) throw new Error("MARKET_ROUTER_ADDRESS is required.");

  const factory = await ethers.getContractAt("HybridMarketFactory", factoryAddress);
  const orderBook = await ethers.getContractAt("HybridOrderBook", orderBookAddress);
  const oldRouter = await ethers.getContractAt("MarketRouter", oldRouterAddress);

  const protocolOwner = process.env.PROTOCOL_OWNER || await factory.owner();
  const feeRecipient = process.env.FEE_RECIPIENT || await oldRouter.feeRecipient();

  console.log("Upgrading router with account:", deployer.address);
  console.log("Factory:", factoryAddress);
  console.log("OrderBook:", orderBookAddress);
  console.log("Old Router:", oldRouterAddress);
  console.log("Protocol owner:", protocolOwner);
  console.log("Fee recipient:", feeRecipient);
  console.log("Chunk shares:", ethers.formatEther(CHUNK_SIZE_WAD));
  console.log("Max trade shares:", ethers.formatEther(MAX_TRADE_SHARES_WAD));
  console.log("Default max hops:", DEFAULT_MAX_HOPS);

  const Router = await ethers.getContractFactory("MarketRouter");
  const router = await Router.deploy(
    deployer.address,
    orderBookAddress,
    feeRecipient,
    CHUNK_SIZE_WAD,
    MAX_TRADE_SHARES_WAD,
    DEFAULT_MAX_HOPS
  );
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  await (await router.setMarketRegistrar(factoryAddress)).wait();
  await (await orderBook.setRouter(routerAddress)).wait();
  await (await factory.setRouter(routerAddress)).wait();

  const totalMarkets = Number(await factory.totalMarkets());
  for (let offset = 0; offset < totalMarkets; offset += 50) {
    const batch = await factory.getMarkets(offset, Math.min(50, totalMarkets - offset));
    for (const market of batch) {
      await (await factory.setMarketOperator(market, routerAddress, true)).wait();
      await (await factory.setMarketAllowed(market, true)).wait();
      console.log("Allowed market:", market);
    }
  }

  if (protocolOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await router.transferOwnership(protocolOwner)).wait();
  }

  const Lens = await ethers.getContractFactory("HybridMarketLens");
  const lens = await Lens.deploy(factoryAddress, routerAddress, orderBookAddress);
  await lens.waitForDeployment();
  const lensAddress = await lens.getAddress();

  console.log("\n=== Router Upgrade Summary ===");
  console.log("MarketRouter     :", routerAddress);
  console.log("HybridMarketLens :", lensAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
