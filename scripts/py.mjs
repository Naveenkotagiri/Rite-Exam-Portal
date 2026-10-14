// Runs the backend's Python (backend/.venv) inside the backend folder, on Windows, macOS and Linux.
// Usage: node scripts/py.mjs -m app.server
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const venv = process.platform === 'win32'
  ? join(backend, '.venv', 'Scripts', 'python.exe')
  : join(backend, '.venv', 'bin', 'python');
const python = existsSync(venv) ? venv : process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const child = spawn(python, process.argv.slice(2), { cwd: backend, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
