// PM2 process manager config for VPS deployment (alongside AchSwap).
// Usage: npx pm2 start ecosystem.config.cjs --env production
// Port 8080 — keep AchSwap on 3000 so both apps share one VPS.
module.exports = {
  apps: [
    {
      name: "achmarket",
      script: "backend/dist/server.js",
      // Loads root .env (Node 20+). dotenv inside server also loads if present.
      node_args: "--env-file=.env",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      // Shared 4GB VPS with AchSwap — keep this modest.
      max_memory_restart: "400M",
      env_production: {
        NODE_ENV: "production",
        PORT: 8080,
      },
    },
  ],
};
