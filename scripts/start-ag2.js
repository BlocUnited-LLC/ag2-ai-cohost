#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'ag2-backend');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(BACKEND_DIR, '.venv', 'bin', 'python');
const APP_MODULE = 'realtime_over_webrtc.main:app';
const PORT = '5050';

const candidates = [];
if (fs.existsSync(VENV_PYTHON)) {
  candidates.push([VENV_PYTHON, ['-m', 'uvicorn', APP_MODULE, '--port', PORT]]);
}
candidates.push(
  ['py', ['-3', '-m', 'uvicorn', APP_MODULE, '--port', PORT]],
  ['python', ['-m', 'uvicorn', APP_MODULE, '--port', PORT]],
  ['python3', ['-m', 'uvicorn', APP_MODULE, '--port', PORT]]
);

function runCandidate(index) {
  if (index >= candidates.length) {
    console.error('[start:ag2] Could not start uvicorn with py/python/python3.');
    console.error('[start:ag2] Run "npm run setup" first, then try again.');
    process.exit(1);
  }

  const [cmd, args] = candidates[index];
  console.log(`[start:ag2] Trying "${cmd} ${args.join(' ')}"`);

  const child = spawn(cmd, args, {
    cwd: BACKEND_DIR,
    stdio: 'inherit'
  });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      runCandidate(index + 1);
      return;
    }
    console.error(`[start:ag2] Failed to start: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(0);
      return;
    }
    process.exit(code == null ? 1 : code);
  });
}

function main() {
  if (!fs.existsSync(BACKEND_DIR)) {
    console.error('[start:ag2] ag2-backend folder is missing.');
    console.error('[start:ag2] Run "npm run setup" first.');
    process.exit(1);
  }
  runCandidate(0);
}

main();
