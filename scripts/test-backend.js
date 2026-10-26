'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const localPython = path.join(root, 'ag2-backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.COHOST_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], {
  cwd: path.join(root, 'ag2-backend'), stdio: 'inherit'
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
