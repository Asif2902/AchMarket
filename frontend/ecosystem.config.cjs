module.exports = {
  apps: [
    {
      name: 'achmarket',
      cwd: __dirname,
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
    },
  ],
};
