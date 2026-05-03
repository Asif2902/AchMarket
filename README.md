# AchMarket

A decentralized prediction market platform built on ARC Testnet. Users can create and trade on outcome-based prediction markets using the LMSR (Logarithmic Market Scoring Rule) mechanism.

## Features

- **Create Markets**: Anyone can create prediction markets for any event
- **Trade Outcomes**: Buy and sell outcome tokens with automated price discovery
- **Liquidity Provision**: Automatic market making via LMSR
- **Settlement**: Automatic resolution and payouts when markets resolve
- **Decentralized**: Fully on-chain, no centralized intermediaries
- **Live Feeds**: Automated market resolution via external data feeds
  - **Crypto Price Feeds**: Track cryptocurrency prices (BTC, ETH, SOL, etc.) with configurable metrics (price, market cap, volume)
  - **Sports Score Feeds**: Automatically resolve sports betting markets using TheSportsDB integration
  - **Smart Detection**: Auto-detect market type from title, category, and description

## Architecture

```
AchMarket/
├── contracts/           # Solidity smart contracts
│   ├── PredictionMarket.sol
│   ├── PredictionMarketFactory.sol
│   ├── PredictionMarketLens.sol
│   └── LMSRMath.sol
├── frontend/            # React + TypeScript frontend
│   ├── api/           # Backend API routes (live feeds, market data)
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Application pages
│   │   ├── services/     # API service layers
│   │   └── types/        # TypeScript type definitions
│   └── public/
├── scripts/            # Deployment scripts
└── whitepaper/         # Protocol documentation
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Install Dependencies

```bash
# Root dependencies
npm install

# Frontend dependencies
cd frontend && npm install
```

### Compile Contracts

```bash
npm run compile
```

### Deploy to ARC Testnet

```bash
npm run deploy
```

### Deploy Locally (Hardhat)

```bash
npm run deploy:local
```

### Frontend Development

```bash
cd frontend
npm run dev
```

### Type Checking

```bash
cd frontend
npm run typecheck
```

## Smart Contracts

### Core Contracts

| Contract | Description |
|----------|-------------|
| `PredictionMarket` | Individual prediction market with LMSR |
| `PredictionMarketFactory` | Factory for creating new markets |
| `PredictionMarketLens` | View functions for market data |
| `LMSRMath` | Math library for LMSR calculations |

### Network Configuration

**ARC Testnet (Chain ID: 5042002)**

| Property | Value |
|----------|-------|
| RPC URL | https://rpc.testnet.arc.network |
| Explorer | https://testnet.arcscan.app |

## Live Feed API

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/live-feed-suggest` | POST | Get feed suggestions based on market data |
| `/api/live-feed-config` | GET/POST | Manage live feed configuration |
| `/api/live-market` | GET | Get live market data and status |

### Currently Supported Crypto Assets

This list is sourced from the live feed asset mapping used by the app. The authoritative source is `frontend/src/config/liveCryptoAssets.ts`.

## Technology Stack

### Smart Contracts
- Solidity
- Hardhat
- OpenZeppelin

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS
- ethers.js

## Roadmap: Next-Generation Hybrid Engine (AMM Optimized by Order Book)

We are upgrading our trading engine to a **Permanent Hybrid Model**. Leveraging our L1's high TPS and sub-second block times (< 0.5s), we will introduce a fully on-chain Central Limit Order Book (CLOB) to run *alongside* our existing LMSR. 

**The Core Mental Model:** 
We are not building an "order book with a fallback." We are building **an AMM that opportunistically upgrades trades using an order book.**
*   **LMSR (The Safety Net):** Provides our always-on baseline liquidity, continuous pricing, and instant execution.
*   **CLOB (The Optimizer):** Sits in front of the LMSR to offer price improvement, tighter spreads, and better capital efficiency.

### 🔧 Core Architecture
- **MarketRouter (The Brain):** Single entry point for ALL trades. Owns execution.
  - `getBestExecution(amount)`: View function utilized by the UI for trade simulation.
  - `previewTrade()`: A dry-run of the router logic allowing safe simulation before execution.
  - *Optimization:* Cache LMSR state locally during the execution loop to avoid repeated expensive storage reads.
- **LMSRMarket:** Existing contract remains unchanged. Core math is not touched.
- **OrderBook:** A basic CLOB utilizing `mapping(price => OrderQueue)` with FIFO ordering per price level.
- **Atomic Execution:** Router executes Order Book first, falling back to LMSR in a single transaction.

### ⚙️ Routing Logic
- **Compare:** Best OB price vs LMSR price.
- **The Loop:** Take cheaper source -> Execute small chunk -> Update price -> Repeat.
  - **Chunk Sizing:** Defined fixed chunk sizes (e.g., small share increments) initially.
  - **Recalculation:** Always recalculate the LMSR price *after* each chunk is filled.
- **Termination Conditions:** The loop ends when `amount filled` is reached OR `maxHops` is hit.
- **Priority Rule:** If prices are equal, the Order Book is always preferred to encourage peer-to-peer liquidity.
- **Hard Fallback:** If the Order Book fails, is empty, or the loop becomes inefficient, the remaining amount immediately shortcuts to a direct LMSR fill. No trade should fail if the LMSR can fill it.

### 📦 Order Book (Phase 1 Simple)
- **Functions:** `placeLimitOrder(price, amount)`, `cancelOrder(orderId)`.
- **View Helpers:** `getBestBid()` and `getBestAsk()`.
- **Tracking:** Maintain total liquidity metrics per price level.
- **Safety:** Map `orderId -> owner` to prevent unauthorized cancellations.
- **Enforcements:** Minimum order sizes (anti-dust) and strict Tick sizes (e.g., $0.01).
- **Optimization:** Prevent duplicate storage reads to save gas early in the implementation.

### ⚠️ Safety & Edge Cases
- **Loop Bounds:** Enforce `maxHops` to prevent gas limit explosions and infinite loops. Support partial fills.
- **Dust Prevention:** Reject orders below a minimum threshold. Reject limit orders placed completely out of range of the current LMSR price.
- **Circuit Breaker:** Implement an emergency pause for the Order Book in the event of an exploit, instantly defaulting all routing strictly to the LMSR.
- **Price Bounds:** Enforce a maximum price deviation from the LMSR (e.g., ±X%) for limit orders.
- **Order Expiry:** Support optional expiry timestamps for limit orders.
- **Security:** Ensure strict Reentrancy protection on the Router contract.
- **MEV Protection:** Enforce global `minSharesOut` and `maxSlippage` checks that calculate across *both* the OB and LMSR execution paths.

### 💰 Economic & Liquidity Controls
- **Default State:** All markets launch with LMSR active. The OB sits on top as optional liquidity.
- **Fee Structure:** Define a distinct Maker fee (e.g., 0% or very low) and Taker fee.
- **Fee Routing:** Implement specific fee split logic depending on the execution path (OB vs LMSR).
- **Arbitrage Soft Limits:** Enforce maximum trade sizes per transaction to prevent arbitrageurs from entirely draining the LMSR in a single block.
- **Tuning:** Actively monitor the OB ↔ LMSR spread and dynamically tune the LMSR `b` parameter (do not leave it static). If LMSR is being drained, increase `b`. If OB is unused, decrease `b`. Optionally, apply a small fee on the LMSR side to reduce pure extraction.

### 🖥️ UI Strategy
- **Default View:** Hide the complexity. Users simply see "Best Price" and "You will receive X shares." Include trade simulations before confirming.
- **Advanced Mode:** Expose the "Price Source" (OB / LMSR / Mixed), order book depth, estimated output across routing paths, and slippage warnings.
- **Transparency:** Clearly warn users when partial fills are a possibility.

### 🚀 Phased Implementation
- **Phase 1 (MVP):** Deploy Router, Basic Order Book (limit/cancel), simple routing (OB -> LMSR). Add `previewTrade()` and best price getters.
- **Phase 2 (Execution):** Loop execution (chunk-based), dynamic LMSR price recalculation, strict slippage enforcement. Add chunk size tuning config, gas usage tracking, and the fail-safe shortcut to LMSR-only if the loop fails.
- **Phase 3 (Incentives):** Launch the Maker incentives dashboard, liquidity depth metrics, and active spread monitoring.
- **Phase 4 (Advanced):** Implement binary search for optimal LMSR chunk sizing, off-chain indexing for lightning-fast OB UI, and explore optional off-chain matching with on-chain settlement.

### ❗ Final Critical Rules
1. **Router** is the only execution authority.
2. **LMSR** must always succeed.
3. **Order Book** must never block execution.
4. **All trades** are atomic or safely partially filled.
5. **Pricing** is always user-protected (slippage enforced globally).

## Recent Updates

- Added kind parity guard to cached snapshots in live-market to prevent serving incompatible payload types
- Cleaned up unreachable code in live-feed-suggest team detection logic
- Enhanced accessibility in CryptoAssetPicker with proper ARIA listbox semantics and keyboard navigation
- Fixed error-to-HTTP mapping in live-feed-config to not misclassify server errors as 400
- Replaced Promise.all with Promise.allSettled in live-feed-suggest for resilient fan-out
- Fixed !teamPair branch to not auto-bind selectedEventId (review-only mode)
- Fixed extractTeamsFromTitle to try segments first and strip leading qualifiers
- Expanded 503 error check in live-market to catch RPC/provider/network failures
- Fixed live-feed-suggest to parse JSON body before extractSignedHeaders to read timestamp correctly
- Fixed getMarketStage in live-market to propagate RPC/provider errors instead of swallowing them
- Extracted normalizeSportsStatus to shared _sports-status.ts module to eliminate duplication
- Fixed CORS preflight in live-feed-suggest to allow signing headers (X-Wallet-Address, X-Timestamp, X-Signature)
- Fixed market stage handling in live-market to fail closed on RPC/read failures
- Added missing environment variable exports (CORS_ALLOWED_ORIGINS, MONGO_URI, MONGO_DB_NAME, RPC_URL, FACTORY_ADDRESS) in live-feed-config
- Improved crypto asset detection with ambiguous alias handling
- Enhanced error handling for sports feed API failures
- Debounced sports search to prevent API spamming
- Fixed race conditions in event lookup and feed suggestions
- Improved forceUpcoming logic to show live status when matches start
- Added dialog semantics and accessibility improvements to modals
- Form validation returns proper 400 errors instead of 500
- Prevented re-entry in form submissions

## License

GNU General Public License v3.0 - see LICENSE file for details.
