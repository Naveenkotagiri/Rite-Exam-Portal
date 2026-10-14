// Run by Playwright before starting the server: empties the e2e database and loads the sample exam + demo drive.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!/exam_e2e/.test(url || '')) throw new Error(`Refusing to reset a non-e2e database: ${url}`);

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await client.end();
execFileSync(process.execPath, ['scripts/py.mjs', '-m', 'app.cli', 'seed'], { stdio: 'inherit' });
