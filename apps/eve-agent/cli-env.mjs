/**
 * Shared local/prod Eve helpers.
 * Production host: https://netbench-eve-criscode2022s-projects.vercel.app
 * (project `netbench-eve`, team `criscode2022s-projects`, AI Gateway via OIDC).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '../..');

export const PROJECT = process.env.EVE_VERCEL_PROJECT || 'netbench-eve';
export const TEAM = process.env.EVE_VERCEL_TEAM || 'criscode2022s-projects';
const ALT_PROJECT = 'netbench-eve-criscode2022s-projects';

export function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function loadEveEnv() {
  loadEnv(resolve(repo, '.env'));
  loadEnv(resolve(here, '.env'));
  loadEnv(resolve(here, '.env.local'));
  if (!process.env.NETBENCH_API_URL) {
    process.env.NETBENCH_API_URL = 'http://127.0.0.1:3001';
  }
}

export function hasGateway() {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
}

export function run(command, args) {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, {
      cwd: here,
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code, signal) => {
      resolveExit(signal ? 1 : (code ?? 1));
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolveExit) => {
    const child = spawn(command, args, {
      cwd: here,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('exit', (code) => {
      resolveExit({ code: code ?? 1, out });
    });
  });
}

export async function vercelLoggedIn() {
  const { code, out } = await runCapture('npx', ['vercel', 'whoami']);
  return code === 0 && !/Logged out/i.test(out);
}

export function printLoginHelp() {
  console.error('[eve] Local Agent needs the same Vercel AI Gateway as production.');
  console.error('[eve] In your own terminal (browser login):');
  console.error('[eve]   npm run login:vercel');
  console.error('[eve]   npm run link:eve');
  console.error('[eve]   npm run dev');
}

export function linkArgs(project = PROJECT) {
  const args = ['eve', 'link', '--non-interactive', '--project', project];
  if (TEAM && project !== ALT_PROJECT) args.push('--team', TEAM);
  return args;
}

export function deployArgs() {
  return ['eve', 'deploy', '--non-interactive', '--yes', '--project', PROJECT, '--team', TEAM];
}

export async function linkProject() {
  console.log(`[eve] Linking Vercel ${PROJECT} (team ${TEAM}) — same AI Gateway as production…`);
  let code = await run('npx', linkArgs());
  loadEveEnv();
  if (code === 0 && hasGateway()) return 0;

  if (!process.env.EVE_VERCEL_PROJECT) {
    console.log(`[eve] Retrying link with --project ${ALT_PROJECT}…`);
    code = await run('npx', linkArgs(ALT_PROJECT));
    loadEveEnv();
    if (code === 0 && hasGateway()) return 0;
  }

  console.log('[eve] Pulling Vercel env (VERCEL_OIDC_TOKEN) into .env.local…');
  await run('npx', ['vercel', 'env', 'pull', '.env.local', '--yes', '--environment', 'production']);
  loadEveEnv();
  return hasGateway() ? 0 : 1;
}
