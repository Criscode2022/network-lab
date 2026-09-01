import 'reflect-metadata';
import { attachWs, createApp } from './create-app.ts';
import { getPool, initDb } from './db.ts';

const port = Number(process.env.PORT || 3001);

async function bootstrap() {
  await initDb();
  const app = await createApp();
  attachWs(app);
  await app.listen(port, '0.0.0.0');
  console.log(
    `NetBench API listening on ${port} (long-running Node, not a 10s serverless timeout)${getPool() ? ' [postgres]' : ' [memory store]'}`,
  );
}

void bootstrap();
