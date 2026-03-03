const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    (await hre.ethers.provider.getBalance(deployer.address)).toString()
  );

  // ── 1. Deploy Factory ──────────────────────────────────────────
  const Factory = await hre.ethers.getContractFactory(
    "PredictionMarketFactory"
  );
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("PredictionMarketFactory deployed to:", factoryAddr);

  // ── 2. Deploy Lens (points at Factory) ─────────────────────────
  const Lens = await hre.ethers.getContractFactory("PredictionMarketLens");
  const lens = await Lens.deploy(factoryAddr);
  await lens.waitForDeployment();
  const lensAddr = await lens.getAddress();
  console.log("PredictionMarketLens   deployed to:", lensAddr);

  // ── Summary ────────────────────────────────────────────────────
  console.log("\n=== Deployment Summary ===");
  console.log("Factory :", factoryAddr);
  console.log("Lens    :", lensAddr);
  console.log("Owner   :", deployer.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
