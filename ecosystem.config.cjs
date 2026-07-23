module.exports = {
  apps: [
    {
      name: "syscca-teamchat-app",
      script: "scripts/start-next.mjs",
      args: "start",
      cwd: "./",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "syscca-teamchat-ws",
      script: "node_modules/.bin/tsx",
      args: "--conditions=react-server server/realtime.ts",
      cwd: "./",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
