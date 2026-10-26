'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const venvPython = path.join(root, 'ag2-backend', '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.COHOST_PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python');
const child = spawn(python, ['-B', '-u', path.join(__dirname, 'backend.py')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Cannot launch test backend with ${python}: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
