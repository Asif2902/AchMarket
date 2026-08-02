# Contributing to AchMarket

## Setup

```bash
git clone https://github.com/Asif2902/AchMarket.git
cd AchMarket
npm install
npm --prefix backend install
npm --prefix frontend install
```

## Checks before a PR

```bash
npm run compile                          # contracts
npm --prefix backend run typecheck
npm --prefix backend run build
npm --prefix frontend run typecheck
npm --prefix frontend run build
./deploy.sh help
```

## Deploy (maintainers)

```bash
./deploy.sh doctor
./deploy.sh update
```

See [DEPLOY.md](./DEPLOY.md).

## Hardhat contracts

```bash
npm run compile
npm run deploy:local
# or npm run deploy  (testnet — needs keys in .env)
```

## Pull requests

- Keep changes focused
- No secrets in git
- Wait for **GitHub Actions** to pass
