const hre = require("hardhat");

const FACTORY_ADDRESS = '0x191C44a5c78Cf936513104557f2354155dfAcCB3';

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

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
