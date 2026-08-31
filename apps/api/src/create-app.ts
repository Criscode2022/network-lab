import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import type { INestApplication } from '@nestjs/common';
import { WebSocketServer, type WebSocket } from 'ws';
import { SimService } from './sim.service.ts';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');
  return app;
}

export function attachWs(app: INestApplication): WebSocketServer {
  const server = app.getHttpServer() as import('node:http').Server;
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sim = app.get(SimService);
  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !sim.sessions.has(sessionId)) {
      ws.close(4404, 'session not found');
      return;
    }
    const s = sim.get(sessionId);
    const timer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'state', state: s.engine.getState() }));
      }
    }, 1000);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; deviceId?: string; line?: string };
        if (msg.type === 'cli' && msg.deviceId && msg.line !== undefined) {
          sim.rateLimit(s);
          const r = s.engine.exec(msg.deviceId, msg.line);
          ws.send(JSON.stringify({ type: 'cli', ...r, state: s.engine.getState() }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', error: e instanceof Error ? e.message : String(e) }));
      }
    });
    ws.on('close', () => clearInterval(timer));
  });
  return wss;
}
