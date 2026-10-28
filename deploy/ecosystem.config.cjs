module.exports = {
  apps: [
    {
      name: 'rip.drumkits.site',
      cwd: '/home/kits4leaks/projects/rip.drumkits.site',
      script: '/home/kits4leaks/.nvm/versions/node/v24.22.1/bin/node',
      args: '--env-file-if-exists=.env src/server.js',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s',
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        PATH: '/home/kits4leaks/.local/bin:/home/kits4leaks/.nvm/versions/node/v24.22.1/bin:/usr/local/bin:/usr/bin:/bin',
      },
    },
  ],
};
