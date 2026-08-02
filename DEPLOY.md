# Deployment (Achswap CLI)

Both **AchMarket** and **AchSwap** use the same modular deploy framework.

## Quick start

```bash
chmod +x deploy.sh up.sh scripts/deploy/*.sh scripts/deploy/lib/*.sh

./deploy.sh setup          # install Node/PM2/nginx + create .env
# edit .env with secrets
./deploy.sh update         # pull + build + PM2 + nginx + health
./deploy.sh ssl            # Let's Encrypt (DNS must point here)
./deploy.sh doctor         # full environment report
```

## Commands

| Command | Purpose |
|---------|---------|
| `./deploy.sh doctor` | Diagnostics (pass/warn/fail) |
| `./deploy.sh setup` | First-time install + env |
| `./deploy.sh install` | System packages only |
| `./deploy.sh env` | Create/fill `.env` defaults |
| `./deploy.sh pull` | `git pull` default branch |
| `./deploy.sh build` | Production build |
| `./deploy.sh deploy` | PM2 start/restart |
| `./deploy.sh update` | Full pipeline |
| `./deploy.sh update --no-pull` | Build + deploy without git |
| `./deploy.sh update --ssl` | Full pipeline + certbot |
| `./deploy.sh health` | Health endpoints |
| `./deploy.sh nginx` | Install nginx site |
| `./deploy.sh ssl` | TLS certificate |
| `./deploy.sh logs` | PM2 logs |
| `./deploy.sh clean` | Remove build artifacts |
| `./deploy.sh help` | Help |

## Configuration

Edit **`scripts/deploy/config.sh`** for project-specific values:

- `APP_NAME`, `DOMAIN`, `APP_PORT`
- `PM2_NAME`, `DEFAULT_BRANCH`
- `BUILD_ARTIFACTS`, `REQUIRED_ENV_KEYS`
- Feature flags: `ENABLE_NGINX`, `ENABLE_SSL`

## Layout

```text
deploy.sh                 # CLI dispatcher
up.sh                     # → deploy.sh update (compat)
scripts/deploy/
  config.sh               # THIS project
  lib/utils.sh            # shared helpers
  doctor.sh install.sh …
```

## AchMarket specifics

| | |
|--|--|
| Domain | `prediction.achswap.app` |
| Port | `8080` |
| PM2 | `achmarket` |
| Build | backend + frontend monorepo |

**Contracts** (Hardhat) stay separate:

```bash
npm run deploy            # or npm run deploy:contracts
```

## Compatibility

```bash
./up.sh                   # still works
./up.sh --ssl
./up.sh --no-pull
```
