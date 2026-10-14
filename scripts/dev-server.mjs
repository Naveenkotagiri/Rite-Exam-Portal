// Development backend: runs the API on port 3000 and restarts it when a backend .py file changes.
// (uvicorn's own --reload sends Ctrl+C to the whole console on Windows, which also stops `npm run dev`.)
import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const venv = process.platform === 'win32' ? join(backend, '.venv', 'Scripts', 'python.exe') : join(backend, '.venv', 'bin', 'python');
const python = existsSync(venv) ? venv : process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const args = ['-m', 'uvicorn', 'app.main:app', '--port', process.env.PORT || '3000'];

let child = null;
let restarting = false;

function start() {
  child = spawn(python, args, { cwd: backend, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (restarting) {
      restarting = false;
      start();
    } else if (code) {
      console.log(`API stopped (exit code ${code}). Fix the error and save a file to start it again.`);
      child = null;
    }
  });
}

let timer;
watch(join(backend, 'app'), { recursive: true }, (_, file) => {
  if (!file || !file.endsWith('.py')) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`Changed: ${file} – restarting API`);
    if (child) {
      restarting = true;
      child.kill();
    } else {
      start();
    }
  }, 300);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restarting = false;
    child?.kill();
    process.exit(0);
  });
}
start();
