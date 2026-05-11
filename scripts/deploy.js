const hre = require("hardhat");

const EXPECTED_CHAIN_ID = Number(process.env.EXPECTED_CHAIN_ID || 5042002);
const TICK_SIZE_WAD = process.env.CLOB_TICK_SIZE_WAD || "10000000000000000"; // 0.01
const MIN_ORDER_SHARES_WAD = process.env.CLOB_MIN_ORDER_SHARES_WAD || "100000000000000000"; // 0.1
const MAX_PRICE_DEVIATION_BPS = process.env.CLOB_MAX_PRICE_DEVIATION_BPS || "5000";
const CHUNK_SIZE_WAD = process.env.ROUTER_CHUNK_SIZE_WAD || "1000000000000000000";
const MAX_TRADE_SHARES_WAD = process.env.ROUTER_MAX_TRADE_SHARES_WAD || "1000000000000000000000";
const DEFAULT_MAX_HOPS = process.env.ROUTER_DEFAULT_MAX_HOPS || "32";
const CHALLENGE_WINDOW_SECONDS = process.env.RESOLUTION_CHALLENGE_WINDOW_SECONDS || String(48 * 60 * 60);
const MIN_BOND_WEI = process.env.RESOLUTION_MIN_BOND_WEI || "100000000000000000"; // 0.1 native
const MAX_BOND_WEI = process.env.RESOLUTION_MAX_BOND_WEI || "100000000000000000000"; // 100 native
const BOND_BPS = process.env.RESOLUTION_BOND_BPS || "100"; // 1%
const RESOLVER_REWARD_WEI = process.env.RESOLUTION_REWARD_WEI || "0";
const RESOLVER_REWARD_POOL_WEI = process.env.RESOLUTION_REWARD_POOL_WEI || "0";
const FACTORY_LIQUIDITY_RESERVE_WEI = process.env.FACTORY_LIQUIDITY_RESERVE_WEI || "0";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer account configured. Set DEPLOYER_PRIVATE_KEY.");

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong network: expected chainId ${EXPECTED_CHAIN_ID}, got ${chainId}.`);
  }

  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  const owner = process.env.PROTOCOL_OWNER || deployer.address;
  const treasury = process.env.RESOLUTION_TREASURY || feeRecipient;
  const reserve = process.env.RESOLUTION_RESERVE || feeRecipient;

  console.log("Deploying v2 hybrid stack with account:", deployer.address);
  console.log("Protocol owner:", owner);
  console.log("Chain ID:", chainId);
  console.log("Fee recipient:", feeRecipient);
  console.log("Resolution treasury:", treasury);
  console.log("Resolution reserve:", reserve);

  const OrderBook = await hre.ethers.getContractFactory("HybridOrderBook");
  const orderBook = await OrderBook.deploy(
    deployer.address,
    feeRecipient,
    TICK_SIZE_WAD,
    MIN_ORDER_SHARES_WAD,
    MAX_PRICE_DEVIATION_BPS
  );
  await orderBook.waitForDeployment();
  const orderBookAddr = await orderBook.getAddress();

  const Router = await hre.ethers.getContractFactory("MarketRouter");
  const router = await Router.deploy(
    deployer.address,
    orderBookAddr,
    feeRecipient,
    CHUNK_SIZE_WAD,
    MAX_TRADE_SHARES_WAD,
    DEFAULT_MAX_HOPS
  );
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();

  const Resolver = await hre.ethers.getContractFactory("BondedResolutionManager");
  const resolver = await Resolver.deploy(
    deployer.address,
    treasury,
    reserve,
    CHALLENGE_WINDOW_SECONDS,
    MIN_BOND_WEI,
    MAX_BOND_WEI,
    BOND_BPS,
    RESOLVER_REWARD_WEI
  );
  await resolver.waitForDeployment();
  const resolverAddr = await resolver.getAddress();

  const MarketImplementation = await hre.ethers.getContractFactory("PredictionMarketV2");
  const marketImplementation = await MarketImplementation.deploy();
  await marketImplementation.waitForDeployment();
  const marketImplementationAddr = await marketImplementation.getAddress();

  const Factory = await hre.ethers.getContractFactory("HybridMarketFactory");
  const factory = await Factory.deploy(
    deployer.address,
    marketImplementationAddr,
    routerAddr,
    orderBookAddr,
    resolverAddr
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  const Lens = await hre.ethers.getContractFactory("HybridMarketLens");
  const lens = await Lens.deploy(factoryAddr, routerAddr, orderBookAddr);
  await lens.waitForDeployment();
  const lensAddr = await lens.getAddress();

  await (await orderBook.setRouter(routerAddr)).wait();
  await (await orderBook.setMarketRegistrar(factoryAddr)).wait();
  await (await router.setMarketRegistrar(factoryAddr)).wait();
  await (await resolver.setMarketRegistrar(factoryAddr)).wait();

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await orderBook.transferOwnership(owner)).wait();
    await (await router.transferOwnership(owner)).wait();
    await (await resolver.transferOwnership(owner)).wait();
    await (await factory.transferOwnership(owner)).wait();
  }

  if (RESOLVER_REWARD_POOL_WEI !== "0") {
    await (await deployer.sendTransaction({ to: resolverAddr, value: RESOLVER_REWARD_POOL_WEI })).wait();
  }

  if (FACTORY_LIQUIDITY_RESERVE_WEI !== "0") {
    await (await deployer.sendTransaction({ to: factoryAddr, value: FACTORY_LIQUIDITY_RESERVE_WEI })).wait();
  }

  console.log("\n=== V2 Hybrid Deployment Summary ===");
  console.log("HybridMarketFactory    :", factoryAddr);
  console.log("PredictionMarketV2 impl:", marketImplementationAddr);
  console.log("MarketRouter           :", routerAddr);
  console.log("HybridOrderBook        :", orderBookAddr);
  console.log("BondedResolutionManager:", resolverAddr);
  console.log("HybridMarketLens       :", lensAddr);
  console.log("Owner                  :", owner);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
