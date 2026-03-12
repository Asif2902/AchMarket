const hre = require("hardhat");

const FACTORY_ADDRESS = '0x914afD6779AC6aD050D36c7323AfC0ab130B9e5F';
const EXPECTED_CHAIN_ID = 5042002;

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const network = hre.network;
  const chainId = Number(network.config.chainId);
  console.log("Current network chainId:", chainId);

  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong network: expected chainId ${EXPECTED_CHAIN_ID}, got ${chainId}. Aborting deployment of PredictionMarketLens.`);
  }

  const provider = hre.ethers.provider;
  const factoryCode = await provider.getCode(FACTORY_ADDRESS);
  if (factoryCode === '0x') {
    throw new Error(`No contract code at FACTORY_ADDRESS ${FACTORY_ADDRESS} on chain ${chainId}. Aborting deployment of PredictionMarketLens.`);
  }

  console.log("Deploying Lens only (Factory:", FACTORY_ADDRESS, ")...");

  const Lens = await hre.ethers.getContractFactory("PredictionMarketLens");
  const lens = await Lens.deploy(FACTORY_ADDRESS);
  await lens.waitForDeployment();
  const lensAddr = await lens.getAddress();

  console.log("PredictionMarketLens deployed to:", lensAddr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
