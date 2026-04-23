# AchMarket

A decentralized prediction market platform built on ARC Testnet. Users can create and trade on outcome-based prediction markets using the LMSR (Logarithmic Market Scoring Rule) mechanism.

## Features

- **Create Markets**: Anyone can create prediction markets for any event
- **Trade Outcomes**: Buy and sell outcome tokens with automated price discovery
- **Liquidity Provision**: Automatic market making via LMSR
- **Settlement**: Automatic resolution and payouts when markets resolve
- **Decentralized**: Fully on-chain, no centralized intermediaries

## Architecture

```
AchMarket/
├── contracts/           # Solidity smart contracts
│   ├── PredictionMarket.sol
│   ├── PredictionMarketFactory.sol
│   ├── PredictionMarketLens.sol
│   └── LMSRMath.sol
├── frontend/            # React + TypeScript frontend
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
- wagmi + viem

## License

GNU General Public License v3.0 - see LICENSE file for details 
