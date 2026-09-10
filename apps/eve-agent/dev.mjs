/**
 * Local Eve = production AI Gateway (OIDC) + local Nest on :3001.
 * Listens on 4010 (Angular proxy / documented port), not eve's bare default 2000.
 */
import { hasGateway, linkProject, loadEveEnv, printLoginHelp, run, vercelLoggedIn } from './cli-env.mjs';

loadEveEnv();

if (!hasGateway()) {
  if (await vercelLoggedIn()) {
    await linkProject();
  }
  if (!hasGateway()) {
    console.error('[eve] No AI Gateway credentials — model calls will fail.');
    printLoginHelp();
  }
}

const code = await run('npx', ['eve', 'dev', '--host', '127.0.0.1', '--port', '4010', '--no-ui']);
process.exit(code);
