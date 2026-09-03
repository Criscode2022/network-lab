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
import {
  applySolution,
  BUILTIN_LABS,
  Engine,
  exercisesForModel,
  labById,
  labFromSpec,
  labStartupErrors,
  labSummary,
  validateLab,
  type LabJson,
} from '@netbench/engine';
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

  async fromHeader(hdr?: string): Promise<AuthUser> {
    if (!hdr?.startsWith('Bearer ')) throw new UnauthorizedException('missing token');
    try {
      const p = jwt.verify(hdr.slice(7), JWT_SECRET) as { sub: string; email: string; guest?: boolean };
      const user = await findUser(p.sub);
      if (user) return { id: user.id, email: user.email, guest: user.guest };
      if (p.guest) return { id: p.sub, email: p.email, guest: true };
      throw new UnauthorizedException('unknown user');
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('invalid token');
    }
  }

  async optional(hdr?: string): Promise<AuthUser | undefined> {
    if (!hdr?.startsWith('Bearer ')) return undefined;
    try {
      return await this.fromHeader(hdr);
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

const OUT_OF_SCOPE = /bgp|mpls|vxlan|802\.1x/i;

/**
 * A build request is either a sentence (`spec`, parsed by `labFromSpec`) or a full lab JSON (`lab`,
 * validated structurally). Startup lines the device CLIs reject are reported, not silently dropped.
 */
function labFromBuildBody(body: { spec?: string; lab?: unknown }): { lab: LabJson; startupErrors: { device: string; line: string; error: string }[] } {
  if (body.lab !== undefined && body.lab !== null) {
    const v = validateLab(body.lab);
    if (!v.ok) throw new HttpException(`invalid lab: ${v.error}`, 400);
    return { lab: v.lab, startupErrors: labStartupErrors(v.lab) };
  }
  if (body.spec && OUT_OF_SCOPE.test(body.spec)) {
    throw new HttpException('NetBench does not implement BGP/MPLS/VXLAN/802.1X. Use OSPF area 0 and the eight device types.', 400);
  }
  return { lab: labFromSpec(body.spec ?? ''), startupErrors: [] };
}

/** Lab JSON as served to clients: the exercise's answer travels only through the explicit solution routes. */
function stripSolution(lab: LabJson): Omit<LabJson, 'solution'> {
  const { solution: _solution, ...rest } = lab;
  void _solution;
  return rest;
}

/** The built-in lab a session was opened from (custom/saved labs have no curriculum entry). */
function curriculumLab(engine: Engine): LabJson | undefined {
  return labById(engine.id);
}

/** Build identity so clients (the Eve host, the UI) can tell "old deploy" from "down" — Railway/Vercel set the commit env vars. */
const BUILD_VERSION =
  process.env.NETBENCH_BUILD ||
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.SOURCE_VERSION?.slice(0, 12) ||
  'dev';
const STARTED_AT = Date.now();

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      ok: true,
      service: 'netbench-api',
      engine: 'discrete-event',
      split: 'long-running-node',
      version: BUILD_VERSION,
      uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
      // Route families the Eve host depends on; lets it diagnose a stale deploy without probing each route.
      eveTools: true,
      idempotency: true,
    };
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
    return {
      token: this.auth.sign(u),
      user: { id: u.id, email: u.email, guest: true },
      warning: 'Guest — this lab is saved in this browser. Sign in to keep it on your account and other devices.',
    };
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
  async me(@Headers('authorization') auth?: string) {
    return { user: await this.auth.fromHeader(auth) };
  }
}

@Controller('labs')
export class LabsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Models first, then exercises. Summaries only: no topology, no solution (the UI fetches those on demand). */
  @Get('builtin')
  builtin() {
    return { labs: BUILTIN_LABS.map(labSummary) };
  }

  /** Full lab JSON minus the solution — an exercise must not leak its own answer through the lab loader. */
  @Get('builtin/:id')
  one(@Param('id') id: string) {
    const lab = labById(id);
    if (!lab) throw new HttpException('unknown lab', 404);
    return stripSolution(lab);
  }

  /** Official fix of an exercise: summary, progressive hints and the patch. 404 for models (nothing to fix). */
  @Get('builtin/:id/solution')
  solution(@Param('id') id: string) {
    const lab = labById(id);
    if (!lab?.solution) throw new HttpException('this lab has no solution (models pass as shipped)', 404);
    return { labId: lab.id, modelId: lab.modelId, ...lab.solution };
  }

  /** Exercises built on a model, for "practice this" links. */
  @Get('builtin/:id/exercises')
  exercises(@Param('id') id: string) {
    if (!labById(id)) throw new HttpException('unknown lab', 404);
    return { labs: exercisesForModel(id).map(labSummary) };
  }

  @Get()
  async list(@Headers('authorization') auth?: string) {
    const u = await this.auth.fromHeader(auth);
    return { labs: await listLabs(u.id) };
  }

  @Post()
  async create(@Headers('authorization') auth: string | undefined, @Body() body: LabJson) {
    const u = await this.auth.fromHeader(auth);
    if (u.guest) throw new HttpException('sign in to save labs to an account', 401);
    return saveLab(u.id, body);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const saved = await getLab(id);
    const builtin = labById(id);
    const row = saved ?? (builtin ? { id, userId: null, name: builtin.name, json: stripSolution(builtin), updatedAt: '' } : undefined);
    if (!row) throw new HttpException('unknown lab', 404);
    return row;
  }

  @Put(':id')
  async put(@Param('id') id: string, @Headers('authorization') auth: string | undefined, @Body() body: LabJson) {
    const u = await this.auth.fromHeader(auth);
    if (u.guest) throw new HttpException('sign in to save', 401);
    return saveLab(u.id, { ...body, id });
  }

  @Delete(':id')
  async del(@Param('id') id: string, @Headers('authorization') auth?: string) {
    const u = await this.auth.fromHeader(auth);
    if (!(await deleteLab(id, u.id))) throw new HttpException('not found', 404);
    return { ok: true };
  }
}

@Controller('sessions')
export class SessionsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SimService) private readonly sim: SimService,
  ) {}

  private async user(auth?: string): Promise<AuthUser> {
    return (await this.auth.optional(auth)) ?? { id: 'anon', email: 'anon@guest.local', guest: true };
  }

  @Post()
  async open(@Headers('authorization') auth: string | undefined, @Body() body: { labId?: string; lab?: LabJson; labKey?: string }) {
    const u = await this.user(auth);
    const saved = body.labId ? await getLab(body.labId) : undefined;
    const lab = body.lab ?? (body.labId ? labById(body.labId) ?? saved?.json : undefined) ?? BUILTIN_LABS[0];
    const labKey = typeof body.labKey === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.labKey) ? body.labKey : undefined;
    const s = this.sim.create(lab, u.id, u.guest, labKey);
    return {
      sessionId: s.id,
      labKey,
      guest: u.guest,
      state: s.engine.getState(),
      warning: u.guest
        ? 'Guest — this lab is saved in this browser. Sign in to keep it on your account and other devices.'
        : undefined,
    };
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

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    const s = this.sim.get(id);
    s.engine.cancel();
    return { ok: true, output: '^C' };
  }

  @Post(':id/save')
  async save(@Param('id') id: string, @Headers('authorization') auth?: string) {
    const s = this.sim.get(id);
    const u = await this.user(auth);
    const json = s.engine.toLab();
    if (u.guest) {
      return {
        ok: true,
        guest: true,
        json,
        warning: 'Guest — this lab is saved in this browser. Sign in to keep it on your account and other devices.',
      };
    }
    const row = await saveLab(u.id, json);
    return { ok: true, lab: row };
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
  build(@Param('id') id: string, @Body() body: { spec?: string; lab?: unknown; confirmToken?: string }) {
    const s = this.sim.get(id);
    this.sim.rateLimit(s);
    try {
      this.sim.consumeConfirm(id, 'build_lab', body.confirmToken);
      const { lab, startupErrors } = labFromBuildBody(body);
      s.engine = Engine.fromLab(lab);
      return { labId: lab.id, lab, startupErrors, check: s.engine.check(), state: s.engine.getState() };
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

  /** `labId` may be the session UUID, the engine lab id or the browser's stable labKey. */
  private session(labId: string, opts: { count?: boolean } = {}) {
    const s = labId ? this.sim.resolve(labId) : undefined;
    if (!s) {
      throw new HttpException(
        `lab session "${labId || '(empty)'}" not found — it expired or the API restarted. Use the labSessionId from the latest [NetBench context] block; the UI recreates the session automatically.`,
        404,
      );
    }
    if (opts.count !== false) this.sim.rateLimit(s);
    return s;
  }

  @Post('confirm')
  confirm(@Body() body: { labId?: string; purpose?: string }) {
    // Minting is paired with the mutating call that follows, which is the one that counts against the rate limit.
    const s = this.session(body.labId ?? '', { count: false });
    const purpose = body.purpose ?? 'apply_lab_patch';
    return { confirmToken: this.sim.mintConfirm(s.id, purpose), labId: s.id };
  }

  @Post('get_lab_state')
  getLabState(@Body() body: { labId?: string }) {
    if (!body.labId) throw new HttpException('labId required', 400);
    const s = this.session(body.labId);
    return { ...s.engine.getState(), labId: s.id, sessionId: s.id };
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

  /** Body field first (what the Eve host sends), header as a fallback for other clients. */
  private idemKey(body: { idempotencyKey?: string }, header: string | undefined): string | undefined {
    const k = (body.idempotencyKey ?? header ?? '').trim();
    return k && k.length <= 120 ? k : undefined;
  }

  @Post('apply_device_config')
  applyCfg(
    @Body() body: { labId?: string; deviceId?: string; commands?: string[]; confirmToken?: string; idempotencyKey?: string },
    @Headers('idempotency-key') idemHeader?: string,
  ) {
    const key = this.idemKey(body, idemHeader);
    const s = this.session(body.labId ?? '', { count: false });
    const replay = this.sim.replayed(s, 'apply_device_config', key);
    if (replay !== undefined) return { ...(replay as object), replayed: true };
    this.sim.rateLimit(s);
    try {
      this.sim.consumeConfirm(s.id, 'apply_device_config', body.confirmToken);
      const r = this.sim.applyConfig(s, body.deviceId ?? '', body.commands ?? []);
      this.sim.remember(s, 'apply_device_config', key, r);
      return r;
    } catch (e) {
      boom(e);
    }
  }

  @Post('apply_lab_patch')
  applyPatch(
    @Body() body: { labId?: string; patch?: unknown; confirmToken?: string; idempotencyKey?: string },
    @Headers('idempotency-key') idemHeader?: string,
  ) {
    const key = this.idemKey(body, idemHeader);
    const s = this.session(body.labId ?? '', { count: false });
    const replay = this.sim.replayed(s, 'apply_lab_patch', key);
    if (replay !== undefined) return { ...(replay as object), replayed: true };
    this.sim.rateLimit(s);
    try {
      this.sim.consumeConfirm(s.id, 'apply_lab_patch', body.confirmToken);
      const r = { ...this.sim.applyPatch(s, body.patch), state: s.engine.getState() };
      this.sim.remember(s, 'apply_lab_patch', key, r);
      return r;
    } catch (e) {
      boom(e);
    }
  }

  @Post('build_lab')
  build(
    @Body() body: { spec?: string; lab?: unknown; confirmToken?: string; labId?: string; idempotencyKey?: string },
    @Headers('idempotency-key') idemHeader?: string,
  ) {
    if (body.spec && OUT_OF_SCOPE.test(body.spec)) {
      throw new HttpException(
        'Eve refuses BGP/MPLS/VXLAN/802.1X. NetBench is a junior-admin lab: use OSPF area 0 and the eight device types.',
        400,
      );
    }
    if (!body.labId) throw new HttpException('labId and confirmToken required', 400);
    const key = this.idemKey(body, idemHeader);
    const s = this.session(body.labId, { count: false });
    const replay = this.sim.replayed(s, 'build_lab', key);
    if (replay !== undefined) return { ...(replay as object), replayed: true };
    this.sim.rateLimit(s);
    let built: ReturnType<typeof labFromBuildBody>;
    try {
      built = labFromBuildBody(body);
      this.sim.consumeConfirm(s.id, 'build_lab', body.confirmToken);
    } catch (e) {
      boom(e);
    }
    s.engine = Engine.fromLab(built.lab);
    const check = s.engine.check();
    const r = {
      labId: s.id,
      lab: built.lab,
      startupErrors: built.startupErrors,
      check,
      summary: `${built.lab.devices.length} devices, ${built.lab.links.length} cables, ${built.lab.checks.length} checks; check ${check.ok ? 'passes' : 'fails: ' + check.results.filter((r) => !r.ok).map((r) => r.reason).join('; ')}${built.startupErrors.length ? `; ${built.startupErrors.length} startup line(s) rejected` : ''}`,
      state: s.engine.getState(),
    };
    this.sim.remember(s, 'build_lab', key, r);
    return r;
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


