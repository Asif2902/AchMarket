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

### Supported Crypto Assets

Bitcoin (BTC), Ethereum (ETH), Solana (SOL), Binance Coin (BNB), Ripple (XRP), Dogecoin (DOGE), Cardano (ADA), Avalanche (AVAX), Toncoin (TON), Chainlink (LINK), Sui (SUI), Polkadot (DOT), Tron (TRX), Arbitrum (ARB), Optimism (OP)

## Technology Stack

### Smart Contracts
- Sol
- Hardhat
- OpenZeppelin

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS
- ethers.js

## Recent Updates

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
