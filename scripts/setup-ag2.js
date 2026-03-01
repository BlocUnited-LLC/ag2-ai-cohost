#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'ag2-backend');
const VENV_DIR = path.join(BACKEND_DIR, '.venv');
const CUSTOM_MAIN = path.join(REPO_ROOT, 'ag2-config', 'main.py');
const BACKEND_MAIN = path.join(BACKEND_DIR, 'realtime_over_webrtc', 'main.py');

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit'
  });
}

function tryRun(commands, cwd, description) {
  for (const [cmd, args] of commands) {
    console.log(`[setup] ${description}: trying "${cmd} ${args.join(' ')}"`);
    const result = run(cmd, args, cwd);
    if (result.error && result.error.code === 'ENOENT') {
      continue;
    }
    if (result.status === 0) {
      return true;
    }
  }
  return false;
}

function ensureBackendRepo() {
  const marker = path.join(BACKEND_DIR, 'realtime_over_webrtc');
  if (fs.existsSync(marker)) {
    console.log('[setup] ag2-backend submodule already populated, skipping.');
    return;
  }
  console.log('[setup] Initialising ag2-backend git submodule...');
  const result = run('git', ['submodule', 'update', '--init', '--recursive'], REPO_ROOT);
  if (result.status !== 0 || !fs.existsSync(marker)) {
    throw new Error('Failed to initialise ag2-backend submodule. Make sure you cloned with --recurse-submodules or run: git submodule update --init');
  }
}

function applyCustomMain() {
  if (!fs.existsSync(CUSTOM_MAIN)) {
    console.warn('[setup] ag2-config/main.py not found — skipping custom agent config.');
    return;
  }
  fs.copyFileSync(CUSTOM_MAIN, BACKEND_MAIN);
  console.log('[setup] Copied ag2-config/main.py → ag2-backend/realtime_over_webrtc/main.py');
}

function ensureConfigFile() {
  const sample = path.join(BACKEND_DIR, 'OAI_CONFIG_LIST_sample');
  const target = path.join(BACKEND_DIR, 'OAI_CONFIG_LIST');
  if (!fs.existsSync(sample)) {
    throw new Error('Missing ag2-backend/OAI_CONFIG_LIST_sample after clone.');
  }
  if (!fs.existsSync(target)) {
    fs.copyFileSync(sample, target);
    console.log('[setup] Created ag2-backend/OAI_CONFIG_LIST from sample.');
  } else {
    console.log('[setup] OAI_CONFIG_LIST already exists, leaving as-is.');
  }

  const cfg = fs.readFileSync(target, 'utf8');
  if (cfg.includes('<your OpenAI API key here>')) {
    console.warn('[setup] OAI_CONFIG_LIST still contains the placeholder API key.');
    console.warn('[setup] Edit ag2-backend/OAI_CONFIG_LIST and set your sk-proj-... key.');
  }
}

function installPythonRequirements() {
  const venvPython = process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python');

  if (!fs.existsSync(venvPython)) {
    const createVenvCommands = [
      ['py', ['-3', '-m', 'venv', '.venv']],
      ['python', ['-m', 'venv', '.venv']],
      ['python3', ['-m', 'venv', '.venv']]
    ];
    const created = tryRun(createVenvCommands, BACKEND_DIR, 'Creating local Python virtual environment');
    if (!created || !fs.existsSync(venvPython)) {
      throw new Error('Failed to create ag2-backend/.venv.');
    }
  } else {
    console.log('[setup] ag2-backend/.venv already exists, reusing it.');
  }

  console.log('[setup] Installing AG2 Python dependencies into ag2-backend/.venv');
  const pipResult = run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], BACKEND_DIR);
  if (pipResult.status !== 0) {
    throw new Error('Failed to install Python dependencies into ag2-backend/.venv.');
  }
}

function main() {
  try {
    ensureBackendRepo();
    applyCustomMain();
    ensureConfigFile();
    installPythonRequirements();
    console.log('[setup] Setup complete.');
    console.log('[setup] Next:');
    console.log('  1) Edit ag2-backend/OAI_CONFIG_LIST and set your sk-proj-... API key.');
    console.log('  2) Run "npm run start:ag2" in one terminal.');
    console.log('  3) Run "npm start" in another terminal.');
  } catch (err) {
    console.error(`[setup] ${err.message}`);
    process.exit(1);
  }
}

main();
