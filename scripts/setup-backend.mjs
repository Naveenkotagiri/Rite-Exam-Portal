// Creates backend/.venv and installs the Python packages. Usage: npm run setup:backend
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const venvPython = process.platform === 'win32' ? join(backend, '.venv', 'Scripts', 'python.exe') : join(backend, '.venv', 'bin', 'python');
const systemPython = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: backend, stdio: 'inherit' });

if (!existsSync(venvPython)) run(systemPython, ['-m', 'venv', '.venv']);
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', '-q']);
run(venvPython, ['-m', 'pip', 'install', '-r', process.argv.includes('--prod') ? 'requirements.txt' : 'requirements-dev.txt', '-q']);
console.log('Python backend is ready.');
