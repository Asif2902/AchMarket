// PM2 — AchMarket on 8080 (AchSwap stays on 3000).
// Env is loaded by backend/dist/server.js from repo-root .env (not --env-file).
const path = require("path");

module.exports = {
  apps: [
    {
      name: "achmarket",
      script: path.join(__dirname, "backend", "dist", "server.js"),
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      min_uptime: "5s",
      max_restarts: 20,
      exp_backoff_restart_delay: 500,
      time: true,
      error_file: path.join(__dirname, "logs", "achmarket-error.log"),
      out_file: path.join(__dirname, "logs", "achmarket-out.log"),
      merge_logs: true,
      // Both env and env_production so a start without --env still stays on 8080
      env: {
        NODE_ENV: "production",
        PORT: "8080",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: "8080",
      },
    },
  ],
};
