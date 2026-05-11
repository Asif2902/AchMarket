const { expect } = require("chai");
const { ethers } = require("hardhat");

const WAD = ethers.parseEther("1");
const SIDE_BID = 0;
const SIDE_ASK = 1;

async function latestDeadline(offset = 3600) {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp + offset;
}

async function deployHybridFixture() {
  const [owner, alice, bob, feeRecipient] = await ethers.getSigners();

  const OrderBook = await ethers.getContractFactory("HybridOrderBook");
  const orderBook = await OrderBook.deploy(
    owner.address,
    feeRecipient.address,
    ethers.parseEther("0.01"),
    ethers.parseEther("0.1"),
    10000
  );
  await orderBook.waitForDeployment();

  const Router = await ethers.getContractFactory("MarketRouter");
  const router = await Router.deploy(
    owner.address,
    await orderBook.getAddress(),
    feeRecipient.address,
    ethers.parseEther("1"),
    ethers.parseEther("1000"),
    16
  );
  await router.waitForDeployment();
  await orderBook.setRouter(await router.getAddress());

  const Resolver = await ethers.getContractFactory("BondedResolutionManager");
  const resolver = await Resolver.deploy(
    owner.address,
    feeRecipient.address,
    feeRecipient.address,
    5 * 60,
    ethers.parseEther("0.01"),
    ethers.parseEther("10"),
    100,
    0
  );
  await resolver.waitForDeployment();

  const Market = await ethers.getContractFactory("PredictionMarketV2");
  const duration = 30 * 24 * 60 * 60;
  const block = await ethers.provider.getBlock("latest");
  const market = await Market.deploy(
    owner.address,
    "Will ARC testnet stay cheap?",
    "Hybrid CLOB test market",
    "Crypto",
    "",
    ["Yes", "No"],
    ethers.parseEther("10"),
    duration,
    "https://example.com/source",
    block.timestamp + duration + 60,
    "https://example.com/fallback",
    "Source unavailable or market wording invalid",
    await resolver.getAddress(),
    [await router.getAddress(), await orderBook.getAddress()],
    { value: ethers.parseEther("100") }
  );
  await market.waitForDeployment();

  await router.setAllowedMarket(await market.getAddress(), true);
  await orderBook.setAllowedMarket(await market.getAddress(), true);
  await resolver.setMarketAllowed(await market.getAddress(), true);

  return { owner, alice, bob, feeRecipient, orderBook, router, resolver, market, duration };
}

describe("Hybrid CLOB + LMSR", function () {
  it("fills a taker buy from the best ask before LMSR when the ask improves price", async function () {
    const { alice, bob, orderBook, router, market } = await deployHybridFixture();
    const marketAddress = await market.getAddress();
    const shares = ethers.parseEther("1");
    const halfShare = ethers.parseEther("0.5");
    const askPrice = ethers.parseEther("0.5");

    await router.connect(alice).buy(
      marketAddress,
      0,
      shares,
      shares,
      ethers.parseEther("10"),
      8,
      await latestDeadline(),
      { value: ethers.parseEther("10") }
    );

    await orderBook.connect(alice).placeLimitOrder(marketAddress, 0, SIDE_ASK, askPrice, halfShare, 0);

    await router.connect(bob).buy(
      marketAddress,
      0,
      halfShare,
      halfShare,
      ethers.parseEther("1"),
      8,
      await latestDeadline(),
      { value: ethers.parseEther("1") }
    );

    expect(await market.sharesOf(bob.address, 0)).to.equal(halfShare);
    const order = await orderBook.orders(1);
    expect(order.remainingSharesWad).to.equal(0);
    expect(order.active).to.equal(false);
  });

  it("fills a taker sell into the best bid when the bid improves LMSR proceeds", async function () {
    const { alice, bob, orderBook, router, market } = await deployHybridFixture();
    const marketAddress = await market.getAddress();
    const shares = ethers.parseEther("1");
    const halfShare = ethers.parseEther("0.5");
    const bidPrice = ethers.parseEther("0.8");

    await router.connect(alice).buy(
      marketAddress,
      0,
      shares,
      shares,
      ethers.parseEther("10"),
      8,
      await latestDeadline(),
      { value: ethers.parseEther("10") }
    );

    await orderBook.connect(bob).placeLimitOrder(
      marketAddress,
      0,
      SIDE_BID,
      bidPrice,
      halfShare,
      0,
      { value: ethers.parseEther("0.4") }
    );

    await router.connect(alice).sell(marketAddress, 0, halfShare, 0, 8, await latestDeadline());

    expect(await market.sharesOf(bob.address, 0)).to.equal(halfShare);
    const order = await orderBook.orders(1);
    expect(order.remainingSharesWad).to.equal(0);
    expect(order.active).to.equal(false);
  });

  it("does not let an unrelated account cancel another maker's order", async function () {
    const { alice, bob, orderBook, router, market } = await deployHybridFixture();
    const marketAddress = await market.getAddress();
    const shares = ethers.parseEther("1");

    await router.connect(alice).buy(
      marketAddress,
      0,
      shares,
      shares,
      ethers.parseEther("10"),
      8,
      await latestDeadline(),
      { value: ethers.parseEther("10") }
    );
    await orderBook.connect(alice).placeLimitOrder(
      marketAddress,
      0,
      SIDE_ASK,
      ethers.parseEther("0.5"),
      ethers.parseEther("0.5"),
      0
    );

    await expect(orderBook.connect(bob).cancelOrder(1)).to.be.revertedWith("OB: not owner");
  });

  it("falls back to LMSR while the order book is paused", async function () {
    const { alice, bob, orderBook, router, market } = await deployHybridFixture();
    const marketAddress = await market.getAddress();
    const shares = ethers.parseEther("1");
    const halfShare = ethers.parseEther("0.5");

    await router.connect(alice).buy(
      marketAddress,
      0,
      shares,
      shares,
      ethers.parseEther("10"),
      8,
      await latestDeadline(),
      { value: ethers.parseEther("10") }
    );
    await orderBook.connect(alice).placeLimitOrder(
      marketAddress,
      0,
      SIDE_ASK,
      ethers.parseEther("0.5"),
      halfShare,
      0
    );
    await orderBook.setPaused(true);

    await router.connect(bob).buy(
      marketAddress,
      0,
      halfShare,
      halfShare,
      ethers.parseEther("10"),
      8,
      await latestDeadline(),
      { value: ethers.parseEther("10") }
    );

    expect(await market.sharesOf(bob.address, 0)).to.equal(halfShare);
    const order = await orderBook.orders(1);
    expect(order.remainingSharesWad).to.equal(halfShare);
    expect(order.active).to.equal(true);
  });
});

describe("Bonded optimistic resolution", function () {
  it("auto-finalizes an unchallenged bonded resolution after the challenge window", async function () {
    const { alice, resolver, market, duration } = await deployHybridFixture();
    const marketAddress = await market.getAddress();
    const bond = await resolver.requiredBond(marketAddress);

    await ethers.provider.send("evm_increaseTime", [duration + 61]);
    await ethers.provider.send("evm_mine", []);

    await resolver.connect(alice).proposeResolution(
      marketAddress,
      0,
      "ipfs://evidence",
      "ipfs://screenshot",
      "The configured source resolved Yes.",
      { value: bond }
    );

    await ethers.provider.send("evm_increaseTime", [5 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);

    await resolver.finalizeUnchallenged(1);
    expect(await market.stage()).to.equal(2n);
    expect(await market.winningOutcome()).to.equal(0n);
  });

  it("sends challenged proposals to owner arbitration and resolves to the challenger when ruled", async function () {
    const { alice, bob, resolver, market, duration } = await deployHybridFixture();
    const marketAddress = await market.getAddress();
    const bond = await resolver.requiredBond(marketAddress);

    await ethers.provider.send("evm_increaseTime", [duration + 61]);
    await ethers.provider.send("evm_mine", []);

    await resolver.connect(alice).proposeResolution(
      marketAddress,
      0,
      "ipfs://yes-evidence",
      "ipfs://yes-proof",
      "Resolver claims Yes.",
      { value: bond }
    );

    await resolver.connect(bob).challengeResolution(
      1,
      1,
      "ipfs://no-evidence",
      "Challenger claims No.",
      { value: bond }
    );

    await resolver.resolveChallenge(1, 1);
    expect(await market.stage()).to.equal(2n);
    expect(await market.winningOutcome()).to.equal(1n);
  });
});

describe("LMSRMath", function () {
  it("keeps probabilities normalized and stable for large share imbalances", async function () {
    const Harness = await ethers.getContractFactory("LMSRMathHarness");
    const harness = await Harness.deploy();
    await harness.waitForDeployment();

    const b = ethers.parseEther("1000");
    const q = [
      ethers.parseEther("50000"),
      ethers.parseEther("1"),
      ethers.parseEther("25000"),
    ];

    const p0 = await harness.impliedProbability(q, 0, b);
    const p1 = await harness.impliedProbability(q, 1, b);
    const p2 = await harness.impliedProbability(q, 2, b);
    const sum = p0 + p1 + p2;

    expect(sum >= WAD - 2n && sum <= WAD + 2n).to.equal(true);
    expect(p0).to.be.greaterThan(p2);
    expect(p2).to.be.greaterThan(p1);
  });

  it("keeps buy cost positive and sell cost negative for the same outcome", async function () {
    const Harness = await ethers.getContractFactory("LMSRMathHarness");
    const harness = await Harness.deploy();
    await harness.waitForDeployment();

    const b = ethers.parseEther("100");
    const q = [ethers.parseEther("1"), ethers.parseEther("2")];
    const delta = ethers.parseEther("0.5");

    expect(await harness.tradeCost(q, 0, delta, b)).to.be.greaterThan(0);
    expect(await harness.tradeCost(q, 0, -delta, b)).to.be.lessThan(0);
  });
});
