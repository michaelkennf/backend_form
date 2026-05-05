module.exports = {
  apps: [
    {
      name: "fikiri-backend",
      cwd: ".",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "development",
        PORT: "8013"
      },
      env_production: {
        NODE_ENV: "production",
        PORT: "8013"
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "500M"
    }
  ]
};
