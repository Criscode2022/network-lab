import { deployArgs, hasGateway, linkProject, loadEveEnv, printLoginHelp, run, vercelLoggedIn } from './cli-env.mjs';

loadEveEnv();

if (!(await vercelLoggedIn())) {
  printLoginHelp();
  process.exit(1);
}

if (!hasGateway()) {
  const linked = await linkProject();
  if (linked !== 0) {
    console.error('[eve] Deploy needs a linked Vercel project (same as production).');
    process.exit(1);
  }
}

process.exit(await run('npx', deployArgs()));
