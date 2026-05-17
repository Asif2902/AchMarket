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

  const oldFactoryAddress = process.env.HYBRID_FACTORY_ADDRESS;
  const oldOrderBookAddress = process.env.ORDER_BOOK_ADDRESS;
  const oldResolverAddress = process.env.RESOLUTION_MANAGER_ADDRESS;
  const oldRouterAddress = process.env.MARKET_ROUTER_ADDRESS;
  if (!oldFactoryAddress) throw new Error("HYBRID_FACTORY_ADDRESS is required.");
  if (!oldOrderBookAddress) throw new Error("ORDER_BOOK_ADDRESS is required.");
  if (!oldResolverAddress) throw new Error("RESOLUTION_MANAGER_ADDRESS is required.");
  if (!oldRouterAddress) throw new Error("MARKET_ROUTER_ADDRESS is required.");

  const oldFactory = await ethers.getContractAt("HybridMarketFactory", oldFactoryAddress);
  const oldRouter = await ethers.getContractAt("MarketRouter", oldRouterAddress);
  const orderBook = await ethers.getContractAt("HybridOrderBook", oldOrderBookAddress);
  const resolver = await ethers.getContractAt("BondedResolutionManager", oldResolverAddress);

  const protocolOwner = process.env.PROTOCOL_OWNER || await oldFactory.owner();
  const feeRecipient = process.env.FEE_RECIPIENT || await oldRouter.feeRecipient();

  console.log("Deploying bounded-MM hybrid stack with account:", deployer.address);
  console.log("Protocol owner:", protocolOwner);
  console.log("Fee recipient:", feeRecipient);
  console.log("OrderBook:", oldOrderBookAddress);
  console.log("Resolver:", oldResolverAddress);
  console.log("Previous Factory:", oldFactoryAddress);
  console.log("Chunk shares:", ethers.formatEther(CHUNK_SIZE_WAD));
  console.log("Max trade shares:", ethers.formatEther(MAX_TRADE_SHARES_WAD));
  console.log("Default max hops:", DEFAULT_MAX_HOPS);

  const MarketImplementation = await ethers.getContractFactory("PredictionMarketV2");
  const marketImplementation = await MarketImplementation.deploy();
  await marketImplementation.waitForDeployment();
  const marketImplementationAddr = await marketImplementation.getAddress();

  const Router = await ethers.getContractFactory("MarketRouter");
  const router = await Router.deploy(
    deployer.address,
    oldOrderBookAddress,
    feeRecipient,
    CHUNK_SIZE_WAD,
    MAX_TRADE_SHARES_WAD,
    DEFAULT_MAX_HOPS
  );
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();

  const Factory = await ethers.getContractFactory("HybridMarketFactory");
  const factory = await Factory.deploy(
    deployer.address,
    marketImplementationAddr,
    routerAddr,
    oldOrderBookAddress,
    oldResolverAddress
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  const Lens = await ethers.getContractFactory("HybridMarketLens");
  const lens = await Lens.deploy(factoryAddr, routerAddr, oldOrderBookAddress);
  await lens.waitForDeployment();
  const lensAddr = await lens.getAddress();

  await (await router.setMarketRegistrar(factoryAddr)).wait();
  await (await orderBook.setRouter(routerAddr)).wait();
  await (await orderBook.setMarketRegistrar(factoryAddr)).wait();
  await (await resolver.setMarketRegistrar(factoryAddr)).wait();

  if (protocolOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await router.transferOwnership(protocolOwner)).wait();
    await (await factory.transferOwnership(protocolOwner)).wait();
  }

  console.log("\n=== Bounded-MM Hybrid Deployment Summary ===");
  console.log("HybridMarketFactory    :", factoryAddr);
  console.log("PredictionMarketV2 impl:", marketImplementationAddr);
  console.log("MarketRouter           :", routerAddr);
  console.log("HybridOrderBook        :", oldOrderBookAddress);
  console.log("BondedResolutionManager:", oldResolverAddress);
  console.log("HybridMarketLens       :", lensAddr);
  console.log("Owner                  :", protocolOwner);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
