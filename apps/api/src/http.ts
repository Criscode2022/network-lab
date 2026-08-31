import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { BUILTIN_LABS, Engine, labById, type LabJson } from '@netbench/engine';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import {
  consumeMagic,
  deleteLab,
  findUser,
  getLab,
  guestUser,
  issueMagic,
  listLabs,
  login,
  register,
  saveLab,
} from './store.ts';
import { SimService } from './sim.service.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'netbench-dev-secret-change-me';

export interface AuthUser {
  id: string;
  email: string;
  guest: boolean;
}

@Injectable()
export class AuthService {
  sign(u: { id: string; email: string; guest: boolean }): string {
    return jwt.sign({ sub: u.id, email: u.email, guest: u.guest }, JWT_SECRET, { expiresIn: '7d' });
  }

  fromHeader(hdr?: string): AuthUser {
    if (!hdr?.startsWith('Bearer ')) throw new UnauthorizedException('missing token');
    try {
      const p = jwt.verify(hdr.slice(7), JWT_SECRET) as { sub: string; email: string; guest?: boolean };
      const user = findUser(p.sub);
      if (!user) throw new UnauthorizedException('unknown user');
      return { id: user.id, email: user.email, guest: user.guest };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('invalid token');
    }
  }

  optional(hdr?: string): AuthUser | undefined {
    if (!hdr?.startsWith('Bearer ')) return undefined;
    try {
      return this.fromHeader(hdr);
    } catch {
      return undefined;
    }
  }
}

function boom(e: unknown): never {
  if (e instanceof HttpException) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number }).status ?? HttpStatus.BAD_REQUEST;
  throw new HttpException(msg, status);
}

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true, service: 'netbench-api', engine: 'discrete-event', split: 'long-running-node' };
  }
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() body: { email?: string; password?: string }) {
    if (!body.email || !body.password) throw new HttpException('email and password required', 400);
    try {
      const u = await register(body.email, body.password);
      return { token: this.auth.sign(u), user: { id: u.id, email: u.email, guest: false } };
    } catch (e) {
      boom(e);
    }
  }

  @Post('login')
  async login(@Body() body: { email?: string; password?: string }) {
    if (!body.email || !body.password) throw new HttpException('email and password required', 400);
    try {
      const u = await login(body.email, body.password);
      return { token: this.auth.sign(u), user: { id: u.id, email: u.email, guest: false } };
    } catch (e) {
      boom(e);
    }
  }

  @Post('guest')
  guest() {
    const u = guestUser();
    return { token: this.auth.sign(u), user: { id: u.id, email: u.email, guest: true }, warning: 'Guest session — reload or closing the tab loses unsaved labs. Sign in to save.' };
  }

  @Post('magic')
  magic(@Body() body: { email?: string }) {
    if (!body.email) throw new HttpException('email required', 400);
    const token = issueMagic(body.email);
    return { ok: true, message: 'Magic link issued (email sending is not configured in this lab; use the token).', token };
  }

  @Post('magic/consume')
  async consume(@Body() body: { token?: string }) {
    if (!body.token) throw new HttpException('token required', 400);
    try {
      const u = await consumeMagic(body.token);
      return { token: this.auth.sign(u), user: { id: u.id, email: u.email, guest: false } };
    } catch (e) {
      boom(e);
    }
  }

  @Get('me')
  me(@Headers('authorization') auth?: string) {
    return { user: this.auth.fromHeader(auth) };
  }
}

@Controller('labs')
export class LabsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('builtin')
  builtin() {
    return { labs: BUILTIN_LABS.map((l) => ({ id: l.id, name: l.name, goal: l.goal, description: l.description })) };
  }

  @Get('builtin/:id')
  one(@Param('id') id: string) {
    const lab = labById(id);
    if (!lab) throw new HttpException('unknown lab', 404);
    return lab;
  }

  @Get()
  list(@Headers('authorization') auth?: string) {
    const u = this.auth.fromHeader(auth);
    return { labs: listLabs(u.id) };
  }

  @Post()
  create(@Headers('authorization') auth: string | undefined, @Body() body: LabJson) {
    const u = this.auth.fromHeader(auth);
    if (u.guest) throw new HttpException('sign in to save labs to an account', 401);
    const row = saveLab(u.id, body);
    return row;
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const row = getLab(id) ?? (labById(id) ? { id, userId: null, name: labById(id)!.name, json: labById(id)!, updatedAt: '' } : undefined);
    if (!row) throw new HttpException('unknown lab', 404);
    return row;
  }

  @Put(':id')
  put(@Param('id') id: string, @Headers('authorization') auth: string | undefined, @Body() body: LabJson) {
    const u = this.auth.fromHeader(auth);
    if (u.guest) throw new HttpException('sign in to save', 401);
    const row = saveLab(u.id, { ...body, id });
    return row;
  }

  @Delete(':id')
  del(@Param('id') id: string, @Headers('authorization') auth?: string) {
    const u = this.auth.fromHeader(auth);
    if (!deleteLab(id, u.id)) throw new HttpException('not found', 404);
    return { ok: true };
  }
}

@Controller('sessions')
export class SessionsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SimService) private readonly sim: SimService,
  ) {}

  private user(auth?: string): AuthUser {
    return this.auth.optional(auth) ?? { id: 'anon', email: 'anon@guest.local', guest: true };
  }

  @Post()
  open(@Headers('authorization') auth: string | undefined, @Body() body: { labId?: string; lab?: LabJson }) {
    const u = this.user(auth);
    const lab = body.lab ?? (body.labId ? labById(body.labId) ?? getLab(body.labId)?.json : undefined) ?? BUILTIN_LABS[0];
    const s = this.sim.create(lab, u.id, u.guest);
    return { sessionId: s.id, guest: u.guest, state: s.engine.getState(), warning: u.guest ? 'Guest session — reload loses unsaved labs.' : undefined };
  }

  @Get(':id/state')
  state(@Param('id') id: string) {
    const s = this.sim.get(id);
    return s.engine.getState();
  }

  @Post(':id/cli')
  cli(@Param('id') id: string, @Body() body: { deviceId?: string; line?: string }) {
    const s = this.sim.get(id);
    this.sim.rateLimit(s);
    if (!body.deviceId || body.line === undefined) throw new HttpException('deviceId and line required', 400);
    const r = s.engine.exec(body.deviceId, body.line);
    return { ...r, state: s.engine.getState(), packets: r.events };
  }

  @Post(':id/check')
  check(@Param('id') id: string) {
    const s = this.sim.get(id);
    return s.engine.check();
  }

  @Post(':id/ping')
  ping(@Param('id') id: string, @Body() body: { src: string; dst: string; family?: 'v4' | 'v6' }) {
    const s = this.sim.get(id);
    this.sim.rateLimit(s);
    return s.engine.ping(body.src, body.dst, { count: 1, family: body.family });
  }

  @Post(':id/path')
  path(@Param('id') id: string, @Body() body: { src: string; dst: string; proto?: string; family?: 'v4' | 'v6' }) {
    const s = this.sim.get(id);
    this.sim.rateLimit(s);
    return s.engine.getPath(body.src, body.dst, body.proto ?? 'icmp', body.family ?? 'v4');
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() body: { purpose?: string }) {
    this.sim.get(id);
    const purpose = body.purpose ?? 'apply_lab_patch';
    return { confirmToken: this.sim.mintConfirm(id, purpose) };
  }

  @Post(':id/edit')
  edit(@Param('id') id: string, @Body() body: { patch?: unknown; move?: { id: string; x: number; y: number }[] }) {
    const s = this.sim.get(id);
    try {
      if (body.patch) this.sim.applyPatch(s, body.patch);
      if (body.move) {
        for (const m of body.move) {
          const d = s.engine.find(m.id);
          if (d) {
            d.x = m.x;
            d.y = m.y;
          }
        }
      }
      return { ok: true, state: s.engine.getState() };
    } catch (e) {
      boom(e);
    }
  }

  @Post(':id/patch')
  patch(@Param('id') id: string, @Body() body: { patch?: unknown; confirmToken?: string }) {
    const s = this.sim.get(id);
    this.sim.rateLimit(s);
    try {
      this.sim.consumeConfirm(id, 'apply_lab_patch', body.confirmToken);
      const r = this.sim.applyPatch(s, body.patch);
      return { ...r, state: s.engine.getState() };
    } catch (e) {
      boom(e);
    }
  }

  @Post(':id/config')
  config(@Param('id') id: string, @Body() body: { deviceId?: string; commands?: string[]; confirmToken?: string }) {
    const s = this.sim.get(id);
    this.sim.rateLimit(s);
    try {
      this.sim.consumeConfirm(id, 'apply_device_config', body.confirmToken);
      if (!body.deviceId || !body.commands) throw new HttpException('deviceId and commands required', 400);
      return this.sim.applyConfig(s, body.deviceId, body.commands);
    } catch (e) {
      boom(e);
    }
  }

  @Post(':id/build')
  build(@Param('id') id: string, @Body() body: { spec?: string; confirmToken?: string }) {
    const s = this.sim.get(id);
    this.sim.rateLimit(s);
    try {
      this.sim.consumeConfirm(id, 'build_lab', body.confirmToken);
      const lab = this.sim.buildOffice();
      if (body.spec && /bgp|mpls|vxlan|802\.1x/i.test(body.spec)) {
        throw new HttpException('NetBench does not implement BGP/MPLS/VXLAN/802.1X. Use OSPF area 0 and the eight device types.', 400);
      }
      s.engine = Engine.fromLab(lab);
      return { labId: lab.id, lab, state: s.engine.getState() };
    } catch (e) {
      boom(e);
    }
  }

  @Post(':id/highlight')
  highlight(@Param('id') id: string, @Body() body: { deviceIds?: string[] }) {
    const s = this.sim.get(id);
    s.engine.highlightIds = body.deviceIds ?? [];
    s.highlights = s.engine.highlightIds;
    return { ok: true, deviceIds: s.highlights };
  }

}

@Controller('commands')
export class CommandsController {
  constructor(@Inject(SimService) private readonly sim: SimService) {}

  @Get(':kind')
  cmds(@Param('kind') kind: string) {
    return { kind, commands: this.sim.commands(kind) };
  }
}

@Controller('eve/tools')
export class EveToolsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SimService) private readonly sim: SimService,
  ) {}

  private session(labId: string) {
    const s = this.sim.sessions.get(labId) ?? [...this.sim.sessions.values()].find((x) => x.engine.id === labId || x.id === labId);
    if (!s) throw new HttpException('lab session not found', 404);
    this.sim.rateLimit(s);
    return s;
  }

  @Post('get_lab_state')
  getLabState(@Body() body: { labId?: string }) {
    if (!body.labId) throw new HttpException('labId required', 400);
    return this.session(body.labId).engine.getState();
  }

  @Post('get_device')
  getDevice(@Body() body: { labId?: string; deviceId?: string }) {
    const s = this.session(body.labId ?? '');
    const d = s.engine.dev(body.deviceId ?? '');
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      runningConfig: s.engine.runningConfig(d),
      startupConfig: d.startupLines.join('\n'),
      arp: d.arp,
      ndp: d.ndp,
      macTable: d.macTable,
      wifi: { ssid: d.associatedSsid, ap: d.associatedAp },
    };
  }

  @Post('get_path')
  getPath(@Body() body: { labId?: string; src?: string; dst?: string; proto?: string; family?: 'v4' | 'v6' }) {
    const s = this.session(body.labId ?? '');
    return s.engine.getPath(body.src ?? '', body.dst ?? '', body.proto ?? 'icmp', body.family ?? 'v4');
  }

  @Post('run_check')
  runCheck(@Body() body: { labId?: string }) {
    return this.session(body.labId ?? '').engine.check();
  }

  @Post('apply_device_config')
  applyCfg(@Body() body: { labId?: string; deviceId?: string; commands?: string[]; confirmToken?: string }) {
    const s = this.session(body.labId ?? '');
    try {
      this.sim.consumeConfirm(s.id, 'apply_device_config', body.confirmToken);
      return this.sim.applyConfig(s, body.deviceId ?? '', body.commands ?? []);
    } catch (e) {
      boom(e);
    }
  }

  @Post('apply_lab_patch')
  applyPatch(@Body() body: { labId?: string; patch?: unknown; confirmToken?: string }) {
    const s = this.session(body.labId ?? '');
    try {
      this.sim.consumeConfirm(s.id, 'apply_lab_patch', body.confirmToken);
      const r = this.sim.applyPatch(s, body.patch);
      return { ...r, state: s.engine.getState() };
    } catch (e) {
      boom(e);
    }
  }

  @Post('build_lab')
  build(@Body() body: { spec?: string; confirmToken?: string; labId?: string }) {
    if (body.spec && /bgp|mpls|vxlan|802\.1x/i.test(body.spec)) {
      throw new HttpException(
        'Eve refuses BGP/MPLS/VXLAN/802.1X. NetBench is a junior-admin lab: use OSPF area 0 and the eight device types.',
        400,
      );
    }
    const lab = this.sim.buildOffice();
    if (body.labId) {
      const s = this.session(body.labId);
      try {
        this.sim.consumeConfirm(s.id, 'build_lab', body.confirmToken);
      } catch (e) {
        boom(e);
      }
      s.engine = Engine.fromLab(lab);
      return { labId: s.id, lab, state: s.engine.getState() };
    }
    throw new HttpException('labId and confirmToken required', 400);
  }

  @Post('highlight_devices')
  highlight(@Body() body: { labId?: string; deviceIds?: string[] }) {
    const s = this.session(body.labId ?? '');
    s.engine.highlightIds = body.deviceIds ?? [];
    return { ok: true, deviceIds: s.engine.highlightIds };
  }

  @Post('list_commands')
  list(@Body() body: { deviceType?: string }) {
    return { commands: this.sim.commands(body.deviceType ?? 'workstation') };
  }
}


