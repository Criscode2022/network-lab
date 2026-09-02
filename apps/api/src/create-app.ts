import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import type { INestApplication } from '@nestjs/common';
import { WebSocketServer, type WebSocket } from 'ws';
import { SimService } from './sim.service.ts';
import { RateLimitFilter } from './rate-limit.filter.ts';
import http from 'node:http';

const EVE_ORIGIN = process.env.EVE_ORIGIN || 'http://127.0.0.1:4010';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({ origin: true, credentials: true, exposedHeaders: ['Retry-After'] });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new RateLimitFilter());
  attachEveProxy(app);
  return app;
}

/** Reverse-proxy the eve Nitro server so GET /eve/v1/health is on the long-running API host. */
function attachEveProxy(app: INestApplication): void {
  const express = app.getHttpAdapter().getInstance() as {
    use: (path: string, handler: (req: http.IncomingMessage & { url?: string; originalUrl?: string; method?: string; headers: http.IncomingHttpHeaders }, res: http.ServerResponse) => void) => void;
  };
  const forward = (prefix: string) => (req: http.IncomingMessage & { url?: string; method?: string; headers: http.IncomingHttpHeaders }, res: http.ServerResponse) => {
    const rest = req.url && req.url !== '/' ? req.url : '';
    const target = new URL(prefix + rest, EVE_ORIGIN);
    const headers = { ...req.headers, host: target.host };
    delete headers.connection;
    const up = http.request(target, { method: req.method, headers }, (incoming) => {
      res.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'eve upstream unavailable' }));
      }
    });
    req.pipe(up);
  };
  express.use('/eve', forward('/eve'));
  express.use('/.well-known/workflow', forward('/.well-known/workflow'));
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
    const sendState = () => {
      if (ws.readyState === ws.OPEN) {
        const state = s.engine.getState();
        ws.send(JSON.stringify({ type: 'state', state, packets: state.packets }));
      }
    };
    sendState();
    const timer = setInterval(sendState, 1000);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; deviceId?: string; line?: string };
        if (msg.type === 'cancel') {
          s.engine.cancel();
          const d = msg.deviceId ? s.engine.find(msg.deviceId) : [...s.engine.devices.values()][0];
          const state = s.engine.getState();
          ws.send(JSON.stringify({ type: 'cli', output: '^C', prompt: d ? s.engine.prompt(d) : '# ', events: [], state }));
          return;
        }
        if (msg.type === 'cli' && msg.deviceId && msg.line !== undefined) {
          sim.rateLimit(s);
          const r = s.engine.exec(msg.deviceId, msg.line);
          const state = s.engine.getState();
          ws.send(JSON.stringify({ type: 'cli', ...r, state, packets: r.events }));
          if (r.events.length) {
            ws.send(JSON.stringify({ type: 'packets', packets: r.events, state }));
          }
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', error: e instanceof Error ? e.message : String(e) }));
      }
    });
    ws.on('close', () => clearInterval(timer));
  });
  return wss;
}
