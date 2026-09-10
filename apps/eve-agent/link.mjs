import { hasGateway, loadEveEnv, linkProject, printLoginHelp, vercelLoggedIn } from './cli-env.mjs';

loadEveEnv();

if (hasGateway()) {
  console.log('[eve] AI Gateway credentials already present (.env / .env.local).');
  process.exit(0);
}

if (!(await vercelLoggedIn())) {
  printLoginHelp();
  process.exit(1);
}

const code = await linkProject();
if (code !== 0) {
  console.error('[eve] Link finished but no VERCEL_OIDC_TOKEN / AI_GATEWAY_API_KEY was written.');
  printLoginHelp();
}
process.exit(code);
