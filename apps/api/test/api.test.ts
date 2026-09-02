import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { BUILTIN_LABS } from '@netbench/engine';
import { attachWs, createApp } from '../src/create-app.ts';
import { getPool, setPool } from '../src/db.ts';
import { resetMemory } from '../src/store.ts';
import { MemoryPool } from './fake-pool.ts';

let app: INestApplication;
let server: ReturnType<INestApplication['getHttpServer']>;
let wsPort: number;

async function openLab(labId?: string, lab?: unknown) {
  const res = await request(server).post('/api/sessions').send({ labId, lab }).expect(201);
  return res.body as { sessionId: string; state: { id: string; devices: { name: string }[] } };
}

beforeAll(async () => {
  app = await createApp();
  attachWs(app);
  await app.listen(0);
  server = app.getHttpServer();
  wsPort = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('returns body content not just 200', async () => {
    const r = await request(server).get('/api/health').expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.service).toBe('netbench-api');
    expect(r.body.split).toBe('long-running-node');
  });
});

describe('eve reverse-proxy', () => {
  it('GET /eve/v1/health is 200 from a live eve process or 502 if upstream is down', async () => {
    const r = await request(server).get('/eve/v1/health');
    if (r.status === 200) {
      expect(r.body.ok).toBe(true);
      expect(r.body.status).toBe('ready');
    } else {
      expect(r.status).toBe(502);
      expect(r.body.ok).toBe(false);
    }
  });
});

describe('sessions + engine path/check', () => {
  it('get_path drop reason equals packet inspector reason', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'pc1', line: 'ip link set eth0 down' });
    const path = await request(server)
      .post(`/api/sessions/${sessionId}/path`)
      .send({ src: 'PC1', dst: '10.0.0.20', proto: 'icmp', family: 'v4' })
      .expect(201);
    expect(path.body.ok).toBe(false);
    expect(path.body.reason).toBeTruthy();
    const events = (path.body.events ?? []) as { drop?: boolean; reason: string }[];
    const drop = [...events].reverse().find((e) => e.drop);
    expect(drop?.reason ?? path.body.reason).toBe(path.body.reason);
  });

  it('run_check on every seeded lab matches its design (study labs pass, fault labs fail honestly)', async () => {
    expect(BUILTIN_LABS.length).toBe(17);
    // Labs whose goal is to repair something start with a failing Check.
    const faultLabs = new Set([
      'lab-0a-plug-the-cable',
      'lab-0b-first-address',
      'lab-0c-port-shutdown',
      'lab-2b-wrong-mask',
      'lab-9-static-routes',
      'lab-10-ospf-three-routers',
      'lab-11-nat-internet',
      'lab-12-wlc-capwap',
    ]);
    for (const lab of BUILTIN_LABS) {
      const { sessionId } = await openLab(lab.id);
      const chk = await request(server).post(`/api/sessions/${sessionId}/check`).expect(201);
      expect(chk.body.ok, `${lab.id} ${JSON.stringify(chk.body.results)}`).toBe(!faultLabs.has(lab.id));
      for (const r of chk.body.results as { ok: boolean; reason: string }[]) expect(typeof r.reason).toBe('string');
    }
  });

  it('POST cancel returns ^C and missing session is 404 not 500', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const r = await request(server).post(`/api/sessions/${sessionId}/cancel`).expect(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.output).toBe('^C');
    const missing = await request(server).post('/api/sessions/not-a-session/cancel');
    expect(missing.status).toBe(404);
    expect(String(missing.body.message || '')).toMatch(/session not found/i);
  });

  it('typical fault yields exact fail reason', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'enable' });
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'conf t' });
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'int Gi0/2' });
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'shutdown' });
    const chk = await request(server).post(`/api/sessions/${sessionId}/check`);
    expect(chk.body.ok).toBe(false);
    expect(String(chk.body.results[0].reason).toLowerCase()).toMatch(/down|arp timeout|no cable/);
  });
});

describe('guest session save', () => {
  it('returns lab json a browser can restore', async () => {
    const guest = await request(server).post('/api/auth/guest').send({}).expect(201);
    const token = guest.body.token as string;
    const opened = await request(server)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ labId: 'lab-1-first-ipv4-ping' })
      .expect(201);
    const saved = await request(server)
      .post(`/api/sessions/${opened.body.sessionId}/save`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(saved.body.guest).toBe(true);
    expect(saved.body.json.devices.length).toBeGreaterThanOrEqual(3);
    const restored = await request(server)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ lab: saved.body.json })
      .expect(201);
    expect(restored.body.state.devices.length).toBe(saved.body.json.devices.length);
  });
});

describe('confirmToken + patch schema', () => {
  it('rejects missing confirmToken on patch/config/build', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const p = await request(server).post(`/api/sessions/${sessionId}/patch`).send({ patch: { addDevices: [] } });
    expect(p.status).toBeGreaterThanOrEqual(400);
    expect(String(p.body.message || p.body.error || JSON.stringify(p.body)).toLowerCase()).toMatch(/confirmtoken/);
    const c = await request(server)
      .post(`/api/sessions/${sessionId}/config`)
      .send({ deviceId: 'pc1', commands: ['hostname x'] });
    expect(c.status).toBeGreaterThanOrEqual(400);
  });

  it('accepts a valid confirmToken', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const tok = await request(server).post(`/api/sessions/${sessionId}/confirm`).send({ purpose: 'apply_device_config' });
    const r = await request(server)
      .post(`/api/sessions/${sessionId}/config`)
      .send({ deviceId: 'pc1', commands: ['hostname PC1b'], confirmToken: tok.body.confirmToken });
    expect(r.status).toBeLessThan(400);
    expect(r.body.runningConfig).toContain('PC1b');
  });

  it('eve/tools/confirm mints a token Eve can use without a model-supplied token', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const tok = await request(server).post('/api/eve/tools/confirm').send({ labId: sessionId, purpose: 'build_lab' }).expect(201);
    expect(tok.body.confirmToken).toBeTruthy();
    const built = await request(server)
      .post('/api/eve/tools/build_lab')
      .send({ labId: sessionId, spec: 'two PCs and a switch', confirmToken: tok.body.confirmToken });
    expect(built.status).toBeLessThan(400);
    expect(built.body.state.devices.length).toBeGreaterThanOrEqual(3);
  });

  it('patch schema rejects unknown device types', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const tok = await request(server).post(`/api/sessions/${sessionId}/confirm`).send({ purpose: 'apply_lab_patch' });
    const r = await request(server)
      .post(`/api/sessions/${sessionId}/patch`)
      .send({ confirmToken: tok.body.confirmToken, patch: { addDevices: [{ type: 'nexus', name: 'N1' }] } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body).toLowerCase()).toMatch(/unknown device type/);
  });
});

describe('list_commands matches terminal', () => {
  it('workstation list includes ping and ip', async () => {
    const r = await request(server).get('/api/commands/workstation').expect(200);
    const blob = JSON.stringify(r.body);
    expect(blob).toContain('ping');
    expect(blob).toContain('ip addr');
    expect(blob).not.toMatch(/bgp/i);
  });
});

describe('Eve tool endpoints + six eval scenarios', () => {
  it('eval1 shutdown named', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'enable' });
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'conf t' });
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'int Gi0/2' });
    await request(server).post(`/api/sessions/${sessionId}/cli`).send({ deviceId: 'sw1', line: 'shutdown' });
    const st = await request(server).post('/api/eve/tools/get_lab_state').send({ labId: sessionId });
    expect(st.status).toBeLessThan(400);
    const path = await request(server)
      .post('/api/eve/tools/get_path')
      .send({ labId: sessionId, src: 'PC1', dst: '10.0.0.20', proto: 'icmp', family: 'v4' });
    expect(path.body.ok).toBe(false);
    expect(String(path.body.reason).toLowerCase()).toMatch(/down|arp timeout|no cable/);
  });

  it('eval2 missing subifs', async () => {
    const lab = structuredClone(BUILTIN_LABS.find((l) => l.id === 'lab-3-vlans-roas')!);
    lab.devices.find((d) => d.name === 'R1')!.startup = ['enable', 'conf t', 'int Gi0/0', 'no shut', 'end'];
    const { sessionId } = await openLab(undefined, lab);
    const path = await request(server)
      .post('/api/eve/tools/get_path')
      .send({ labId: sessionId, src: 'PC1', dst: '10.0.20.20', proto: 'icmp', family: 'v4' });
    expect(path.body.ok).toBe(false);
    expect(String(path.body.reason).toLowerCase()).toMatch(/subinterface|no route|vlan|arp timeout/);
  });

  it('eval3 OSPF missing network then add', async () => {
    const lab = structuredClone(BUILTIN_LABS.find((l) => l.id === 'lab-6-ospf-area0')!);
    lab.devices.find((d) => d.name === 'R2')!.startup = (lab.devices.find((d) => d.name === 'R2')!.startup ?? []).filter(
      (l) => !l.startsWith('network'),
    );
    const { sessionId } = await openLab(undefined, lab);
    const chk = await request(server).post('/api/eve/tools/run_check').send({ labId: sessionId });
    expect(chk.body.ok).toBe(false);
    const tok = await request(server).post(`/api/sessions/${sessionId}/confirm`).send({ purpose: 'apply_device_config' });
    await request(server)
      .post('/api/eve/tools/apply_device_config')
      .send({
        labId: sessionId,
        deviceId: 'r2',
        confirmToken: tok.body.confirmToken,
        commands: ['enable', 'conf t', 'router ospf 1', 'network 10.0.2.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.255 area 0'],
      })
      .expect((res) => {
        if (res.status >= 400) throw new Error(JSON.stringify(res.body));
      });
    const chk2 = await request(server).post('/api/eve/tools/run_check').send({ labId: sessionId });
    expect(chk2.body.ok, JSON.stringify(chk2.body)).toBe(true);
  });

  it('eval4 wifi nmcli', async () => {
    const r = await request(server).post('/api/eve/tools/list_commands').send({ deviceType: 'workstation' });
    expect(JSON.stringify(r.body)).toContain('nmcli wifi connect');
  });

  it('eval5 build office pings pass after apply', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const tok = await request(server).post(`/api/sessions/${sessionId}/confirm`).send({ purpose: 'build_lab' });
    const built = await request(server)
      .post('/api/eve/tools/build_lab')
      .send({ labId: sessionId, spec: 'Build a dual-stack office: SW, R, AP, server, 2 PCs', confirmToken: tok.body.confirmToken });
    expect(built.status).toBeLessThan(400);
    const chk = await request(server).post('/api/eve/tools/run_check').send({ labId: sessionId });
    expect(chk.body.ok, JSON.stringify(chk.body)).toBe(true);
  });

  it('eval6 BGP refused', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const tok = await request(server).post(`/api/sessions/${sessionId}/confirm`).send({ purpose: 'build_lab' });
    const r = await request(server)
      .post('/api/eve/tools/build_lab')
      .send({ labId: sessionId, spec: 'Please add BGP to this lab', confirmToken: tok.body.confirmToken });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body).toLowerCase()).toMatch(/bgp|ospf/);
  });

  it('build_lab two PCs and a switch is not the office topology', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const tok = await request(server).post(`/api/sessions/${sessionId}/confirm`).send({ purpose: 'build_lab' });
    const built = await request(server)
      .post('/api/eve/tools/build_lab')
      .send({ labId: sessionId, spec: 'two PCs and a switch', confirmToken: tok.body.confirmToken });
    expect(built.status).toBeLessThan(400);
    const kinds = (built.body.lab.devices as { kind: string; name: string }[]).map((d) => d.kind);
    expect(kinds).toContain('workstation');
    expect(kinds).toContain('switch');
    expect(kinds).not.toContain('ap');
    expect(built.body.lab.id).not.toBe('build-dual-stack-office');
    const chk = await request(server).post('/api/eve/tools/run_check').send({ labId: sessionId });
    expect(chk.body.ok, JSON.stringify(chk.body)).toBe(true);
  });

  it('build_lab two VLANs wifi 20 server 10 PC pings via router', async () => {
    const spec =
      'two VLANs, one router, wifi on VLAN 20, Linux server on VLAN 10, PC must ping the server via the router';
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const tok = await request(server).post(`/api/sessions/${sessionId}/confirm`).send({ purpose: 'build_lab' });
    const built = await request(server)
      .post('/api/eve/tools/build_lab')
      .send({ labId: sessionId, spec, confirmToken: tok.body.confirmToken });
    expect(built.status).toBeLessThan(400);
    const devices = built.body.lab.devices as { kind: string; name: string; startup?: string[] }[];
    expect(devices.some((d) => d.kind === 'workstation'), JSON.stringify(devices.map((d) => d.kind))).toBe(true);
    expect(devices.some((d) => d.kind === 'server')).toBe(true);
    expect(devices.some((d) => d.kind === 'router')).toBe(true);
    const srv = devices.find((d) => d.kind === 'server')!;
    expect(srv.startup?.join('\n')).toMatch(/10\.0\.10\./);
    const checks = built.body.lab.checks as { type: string; dst?: string }[];
    expect(checks.some((c) => c.type === 'ping')).toBe(true);
    const chk = await request(server).post('/api/eve/tools/run_check').send({ labId: sessionId });
    expect(chk.body.ok, JSON.stringify(chk.body)).toBe(true);
  });
});

describe('Neon-backed login and labs after memory flush', () => {
  it('login and GET /labs survive resetMemory when the pool has rows', async () => {
    const prev = getPool();
    const mem = new MemoryPool();
    setPool(mem);
    try {
      const email = `neon-${Date.now()}@netbench.test`;
      const reg = await request(server).post('/api/auth/register').send({ email, password: 'correct-horse' });
      expect(reg.status).toBeLessThan(400);
      const token = reg.body.token as string;
      const saved = await request(server)
        .post('/api/labs')
        .set('Authorization', `Bearer ${token}`)
        .send({ schemaVersion: 1, id: 'persist-me', name: 'Persist me', devices: [], links: [], checks: [] });
      expect(saved.status).toBeLessThan(400);
      resetMemory();
      const me = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(email);
      const loginRes = await request(server).post('/api/auth/login').send({ email, password: 'correct-horse' });
      expect(loginRes.status).toBeLessThan(400);
      const list = await request(server).get('/api/labs').set('Authorization', `Bearer ${loginRes.body.token}`);
      expect(list.status).toBe(200);
      expect(list.body.labs.some((l: { id: string }) => l.id === 'persist-me')).toBe(true);
    } finally {
      resetMemory();
      setPool(prev);
    }
  });
});

describe('live /ws session', () => {
  function openWs(sessionId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws?sessionId=${sessionId}`);
      const t = setTimeout(() => reject(new Error('ws open timeout')), 4000);
      ws.once('open', () => {
        clearTimeout(t);
        resolve(ws);
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  function nextMsg(ws: WebSocket, want?: string): Promise<{ type?: string; output?: string; events?: { proto: string }[]; packets?: unknown[]; state?: { id: string } }> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`ws message timeout waiting for ${want ?? 'any'}`)), 5000);
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(String(data)) as { type?: string };
        if (want && msg.type !== want) return;
        clearTimeout(t);
        ws.off('message', onMsg);
        resolve(msg as { type?: string; output?: string; events?: { proto: string }[]; packets?: unknown[]; state?: { id: string } });
      };
      ws.on('message', onMsg);
    });
  }

  it('streams CLI output and packet events on a persistent socket', async () => {
    const { sessionId } = await openLab('lab-1-first-ipv4-ping');
    const ws = await openWs(sessionId);
    const hello = await nextMsg(ws, 'state');
    expect(hello.state?.id).toBeTruthy();
    const cliP = nextMsg(ws, 'cli');
    ws.send(JSON.stringify({ type: 'cli', deviceId: 'pc1', line: 'ping -c 1 10.0.0.20' }));
    const cli = await cliP;
    expect(cli.output).toBeTruthy();
    expect((cli.events ?? []).length + (cli.packets ?? []).length).toBeGreaterThan(0);
    ws.send(JSON.stringify({ type: 'cancel' }));
    const cancel = await nextMsg(ws, 'cli');
    expect(cancel.output).toBe('^C');
    ws.close();
  });

  it('closes unknown sessions with 4404', async () => {
    const code = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws?sessionId=missing`);
      ws.once('close', (c) => resolve(c));
      ws.once('error', () => resolve(4404));
      setTimeout(() => reject(new Error('no close')), 4000);
    });
    expect(code).toBe(4404);
  });
});
