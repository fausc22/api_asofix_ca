module.exports = {
  apps: [{
    name: 'caradvice-api',
    script: './dist/index.js',
    cwd: '/opt/caradvice-api/backend',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    error_file: '/opt/caradvice-api/backend/logs/pm2-error.log',
    out_file: '/opt/caradvice-api/backend/logs/pm2-out.log',
    log_file: '/opt/caradvice-api/backend/logs/pm2-combined.log',
    time: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    merge_logs: true,
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};

