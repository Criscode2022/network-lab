import { helpText } from './commands.ts';
import { applySwitchProfile, createDevice, ensureSubif, ensureSvi, findIface } from './devices.ts';
import {
  MAC_BCAST,
  allocMac,
  broadcastAddr,
  formatIPv4,
  formatIPv6,
  inSubnet,
  isIPv4Literal,
  isIPv6Literal,
  ipv6PrefixMatch,
  linkLocalFromMac,
  networkAddr,
  parseCidrV4,
  parseCidrV6,
  parseIPv4,
  parseIPv6,
  parseMaskOrPrefix,
  prefixToMask,
  slaacAddress,
  wildcardToPrefix,
} from './ip.ts';
import { cableCarrier, cableLabel, fiberCapable } from './cables.ts';
import type {
  AclRule,
  CableMedia,
  CheckResult,
  CliResult,
  Device,
  DeviceKind,
  Family,
  Frame,
  Iface,
  L3Packet,
  LabCheck,
  LabJson,
  LabPatch,
  Link,
  PacketEvent,
  PathResult,
  PingResult,
  RouteV4,
  RouteV6,
  SwitchProfile,
} from './types.ts';
import { DEVICE_KINDS, HOST_KINDS, isManagedSwitch, isMultilayerSwitch, switchProfileOf } from './types.ts';

let pktSeq = 1;
function nid(p: string): string {
  return `${p}${pktSeq++}`;
}

function parseEndpoint(s: string): { name: string; iface: string } {
  const i = s.lastIndexOf(':');
  if (i < 0) throw new Error(`endpoint must be Name:iface (${s})`);
  return { name: s.slice(0, i), iface: s.slice(i + 1) };
}

export class Engine {
  id = 'lab';
  name = 'Lab';
  goal = '';
  description = '';
  differsNote =
    'How this lab differs from real gear: Wi-Fi RF is a simplified BSS (SSID, channel, PSK, association) then normal IP. SSH is path+port 22, not crypto. OSPF is single area 0. Approximations are marked simulated.';
  devices = new Map<string, Device>();
  links: Link[] = [];
  packets: PacketEvent[] = [];
  now = 0;
  checks: LabCheck[] = [];
  warnings: string[] = [];
  activity: { t: string; msg: string }[] = [];
  lastCheck: CheckResult | null = null;
  private q: { t: number; run: () => void }[] = [];
  private pendingArp: {
    devId: string;
    iface: string;
    ip: string;
    pkt: L3Packet;
  }[] = [];
  private pendingNs: {
    devId: string;
    iface: string;
    ip: string;
    pkt: L3Packet;
  }[] = [];
  private echoWait: { id: number; seq: number; got: boolean } | null = null;
  private traceHop: { ttl: number; from?: string; reply?: string } | null = null;
  highlightIds: string[] = [];
  cancelled = false;

  cancel(): void {
    this.cancelled = true;
    this.q = [];
  }

  logActivity(msg: string): void {
    this.activity.push({ t: new Date().toISOString(), msg });
    if (this.activity.length > 200) this.activity.shift();
  }

  static fromLab(json: LabJson): Engine {
    const e = new Engine();
    e.id = json.id;
    e.name = json.name;
    e.goal = json.goal ?? '';
    e.description = json.description ?? '';
    if (json.differsNote) e.differsNote = json.differsNote;
    e.checks = json.checks ?? [];
    for (const d of json.devices) {
      const dev = createDevice(d.kind, d.name, d.x, d.y, d.id, d.switchProfile);
      if (d.hostname) dev.hostname = d.hostname;
      if (d.switchProfileSnapshots) dev.switchProfileSnapshots = structuredClone(d.switchProfileSnapshots);
      dev.startupLines = [...(d.startup ?? [])];
      (dev as Device & { postLines?: string[] }).postLines = [...(d.post ?? [])];
      e.devices.set(dev.id, dev);
    }
    for (const l of json.links) e.addLink(l.a, l.b, false, l.cable ?? 'ethernet');
    for (const d of e.devices.values()) {
      for (const line of d.startupLines) {
        e.exec(d.id, line);
      }
      d.cli.level = d.kind === 'switch' || d.kind === 'router' || d.kind === 'ap' || d.kind === 'wlc' ? 'user' : 'priv';
    }
    e.recomputeStp();
    e.converge();
    for (const d of e.devices.values()) {
      const post = (d as Device & { postLines?: string[] }).postLines ?? [];
      for (const line of post) e.exec(d.id, line);
      d.cli.level = d.kind === 'switch' || d.kind === 'router' || d.kind === 'ap' || d.kind === 'wlc' ? 'user' : 'priv';
    }
    e.packets = [];
    e.converge();
    return e;
  }

  toLab(): LabJson {
    return {
      schemaVersion: 1,
      id: this.id,
      name: this.name,
      description: this.description,
      goal: this.goal,
      differsNote: this.differsNote,
      devices: [...this.devices.values()].map((d) => {
        const post = this.snapshotPost(d);
        return {
          id: d.id,
          kind: d.kind,
          ...(d.kind === 'switch' ? { switchProfile: d.switchProfile ?? 'managed-l2' } : {}),
          ...(d.kind === 'switch' && d.switchProfileSnapshots && Object.keys(d.switchProfileSnapshots).length
            ? { switchProfileSnapshots: structuredClone(d.switchProfileSnapshots) }
            : {}),
          name: d.name,
          x: d.x,
          y: d.y,
          hostname: d.hostname,
          startup: this.snapshotStartup(d),
          ...(post.length ? { post } : {}),
        };
      }),
      links: this.links.filter((l) => l.kind === 'copper').map((l) => ({
        a: `${this.dev(l.a.deviceId).name}:${l.a.iface}`,
        b: `${this.dev(l.b.deviceId).name}:${l.b.iface}`,
        ...(l.cable && l.cable !== 'ethernet' ? { cable: l.cable } : {}),
      })),
      checks: this.checks,
    };
  }

  /** Replayable CLI that rebuilds current addressing, ports, and routes. */
  snapshotStartup(d: Device): string[] {
    const linux = HOST_KINDS.includes(d.kind) || d.kind === 'firewall' || d.kind === 'cloud';
    if (linux) {
      const L: string[] = [];
      if (d.hostname && d.hostname !== d.name) L.push(`hostname ${d.hostname}`);
      for (const i of d.ifaces) {
        if (i.ipv4) L.push(`ip addr add ${i.ipv4.ip}/${i.ipv4.prefix} dev ${i.name}`);
        for (const v of i.ipv6.filter((x) => !x.ip.toLowerCase().startsWith('fe80'))) {
          L.push(`ip addr add ${v.ip}/${v.prefix} dev ${i.name}`);
        }
        if (i.adminUp) L.push(`ip link set ${i.name} up`);
      }
      if (d.defaultGw4) L.push(`ip route add default via ${d.defaultGw4}`);
      if (d.defaultGw6) L.push(`ip route add default via ${d.defaultGw6}`);
      if (d.sshListen) L.push('systemctl start ssh');
      return L;
    }
    if (d.kind === 'switch' && d.switchProfile === 'unmanaged') return [];
    const L: string[] = ['enable', 'conf t'];
    if (d.hostname) L.push(`hostname ${d.hostname}`);
    if (isMultilayerSwitch(d) && d.ipRouting) L.push('ip routing');
    if (d.kind === 'switch') {
      for (const v of d.vlans.filter((x) => x !== 1)) L.push(`vlan ${v}`);
    }
    for (const i of d.ifaces) {
      L.push(`interface ${i.name}`);
      if (i.mode === 'access' && (d.kind === 'switch' || i.isRadio)) {
        L.push('switchport mode access');
        L.push(`switchport access vlan ${i.accessVlan}`);
      }
      if (i.mode === 'routed' && d.kind === 'switch' && i.vlanId === undefined) L.push('no switchport');
      if (i.mode === 'trunk') {
        L.push('switchport mode trunk');
        L.push(`switchport trunk allowed vlan ${i.allowedVlans === 'all' ? 'all' : i.allowedVlans.join(',')}`);
        if (i.nativeVlan !== 1) L.push(`switchport trunk native vlan ${i.nativeVlan}`);
      }
      if (i.encapVlan) L.push(`encapsulation dot1Q ${i.encapVlan}`);
      if (i.ipv4) L.push(`ip address ${i.ipv4.ip} ${formatIPv4(prefixToMask(i.ipv4.prefix))}`);
      for (const v of i.ipv6.filter((x) => !x.ip.toLowerCase().startsWith('fe80'))) {
        L.push(`ipv6 address ${v.ip}/${v.prefix}`);
      }
      if (i.helperAddress) L.push(`ip helper-address ${i.helperAddress}`);
      L.push(i.adminUp ? 'no shutdown' : 'shutdown');
    }
    if (d.defaultGw4 && d.kind === 'switch') L.push(`ip default-gateway ${d.defaultGw4}`);
    for (const r of d.routesV4.filter((x) => x.proto === 'static')) {
      L.push(`ip route ${r.dest} ${formatIPv4(prefixToMask(r.prefix))} ${r.nexthop ?? r.iface}`);
    }
    if (d.ospf.enabled) {
      L.push('router ospf 1');
      if (d.ospf.routerId) L.push(`router-id ${d.ospf.routerId}`);
      for (const n of d.ospf.networks) L.push(`network ${n.network} ${n.wildcard} area 0`);
    }
    for (const p of d.dhcpPools) {
      L.push(`ip dhcp pool ${p.name}`);
      if (p.network) L.push(`network ${p.network} ${formatIPv4(prefixToMask(p.prefix ?? 24))}`);
      if (p.gateway) L.push(`default-router ${p.gateway}`);
    }
    for (const range of d.dhcpExcluded) {
      L.push(`ip dhcp excluded-address ${range.start}${range.end !== range.start ? ` ${range.end}` : ''}`);
    }
    for (const w of d.wifi) {
      L.push(`ssid ${w.ssid}`);
      L.push(`vlan ${w.vlan}`);
      if (w.psk) L.push(`wpa2-psk ${w.psk}`);
      L.push(`channel ${w.channel}`);
    }
    L.push('end');
    return L;
  }

  snapshotPost(d: Device): string[] {
    if (!d.associatedSsid) return [];
    const ap =
      (d.associatedAp ? this.devices.get(d.associatedAp) : undefined) ??
      [...this.devices.values()].find((x) => x.kind === 'ap' && x.wifi.some((w) => w.ssid === d.associatedSsid));
    const conf = ap?.wifi.find((w) => w.ssid === d.associatedSsid);
    const psk = conf?.psk;
    return [`nmcli wifi connect ${d.associatedSsid}${psk ? ` password ${psk}` : ''}`];
  }

  snapshotRunning(): Record<string, string> {
    const o: Record<string, string> = {};
    for (const d of this.devices.values()) o[d.id] = this.runningConfig(d);
    return o;
  }

  dev(idOrName: string): Device {
    const d = this.find(idOrName);
    if (!d) throw new Error(`unknown device ${idOrName}`);
    return d;
  }

  find(idOrName: string): Device | undefined {
    const k = idOrName.toLowerCase();
    for (const d of this.devices.values()) {
      if (d.id.toLowerCase() === k || d.name.toLowerCase() === k || d.hostname.toLowerCase() === k) return d;
    }
    return undefined;
  }

  addDevice(kind: DeviceKind, name: string, x = 120, y = 120, switchProfile?: SwitchProfile): Device {
    if (this.find(name)) throw new Error(`device ${name} exists`);
    const d = createDevice(kind, name, x, y, undefined, switchProfile);
    this.devices.set(d.id, d);
    this.logActivity(`add device ${name} (${kind})`);
    return d;
  }

  setSwitchProfile(idOrName: string, switchProfile: SwitchProfile): void {
    const d = this.dev(idOrName);
    const prev = switchProfileOf(d);
    if (prev === switchProfile) return;
    if (prev && prev !== 'unmanaged') {
      d.switchProfileSnapshots = { ...d.switchProfileSnapshots, [prev]: this.snapshotStartup(d) };
    }
    applySwitchProfile(d, switchProfile);
    const saved = switchProfile === 'unmanaged' ? undefined : d.switchProfileSnapshots?.[switchProfile];
    if (saved?.length) {
      for (const line of saved) this.exec(d.id, line);
      d.cli = { level: 'user' };
    }
    this.logActivity(`${d.name} switch profile ${switchProfile}`);
    this.recomputeStp();
    this.converge();
  }

  removeDevice(idOrName: string): void {
    const d = this.dev(idOrName);
    this.links = this.links.filter((l) => l.a.deviceId !== d.id && l.b.deviceId !== d.id);
    this.devices.delete(d.id);
    this.logActivity(`remove device ${d.name}`);
    this.recomputeStp();
  }

  addLink(a: string, b: string, log = true, cable: CableMedia = 'ethernet'): Link {
    const ea = parseEndpoint(a);
    const eb = parseEndpoint(b);
    const da = this.dev(ea.name);
    const db = this.dev(eb.name);
    const ia = findIface(da, ea.iface);
    const ib = findIface(db, eb.iface);
    if (!ia || !ib) throw new Error(`unknown iface on ${a} or ${b}`);
    if (ia.isRadio || ib.isRadio) throw new Error('copper cable cannot terminate on a radio port; associate Wi-Fi instead');
    const taken = (dev: Device, iface: Iface) => {
      const p = this.peer(dev.id, iface.name);
      if (p) throw new Error(`${dev.name} ${iface.name} is already cabled to ${p.dev.name} ${p.iface.name}`);
    };
    taken(da, ia);
    taken(db, ib);
    if (cable === 'fiber') {
      if (!fiberCapable(da.kind)) throw new Error(`fiber cannot terminate on ${da.name} (${da.kind} has no SFP)`);
      if (!fiberCapable(db.kind)) throw new Error(`fiber cannot terminate on ${db.name} (${db.kind} has no SFP)`);
    }
    ia.adminUp = true;
    ib.adminUp = true;
    const id = nid('L');
    const link: Link = {
      id,
      a: { deviceId: da.id, iface: ia.name },
      b: { deviceId: db.id, iface: ib.name },
      kind: 'copper',
      cable,
    };
    this.links.push(link);
    if (log) this.logActivity(`${cableLabel(cable)} ${a} — ${b}`);
    this.recomputeStp();
    return link;
  }

  removeLink(idOrEnds: string): void {
    const before = this.links.length;
    this.links = this.links.filter((l) => {
      if (l.id === idOrEnds) return false;
      const ends = `${this.dev(l.a.deviceId).name}:${l.a.iface}--${this.dev(l.b.deviceId).name}:${l.b.iface}`;
      return ends !== idOrEnds && !idOrEnds.split(',').includes(l.id);
    });
    if (this.links.length !== before) this.logActivity(`uncable ${idOrEnds}`);
    this.recomputeStp();
  }

  peer(devId: string, iface: string): { dev: Device; iface: Iface; link: Link } | undefined {
    for (const l of this.links) {
      if (l.a.deviceId === devId && l.a.iface.toLowerCase() === iface.toLowerCase()) {
        const d = this.devices.get(l.b.deviceId);
        const i = d && findIface(d, l.b.iface);
        if (d && i) return { dev: d, iface: i, link: l };
      }
      if (l.b.deviceId === devId && l.b.iface.toLowerCase() === iface.toLowerCase()) {
        const d = this.devices.get(l.a.deviceId);
        const i = d && findIface(d, l.a.iface);
        if (d && i) return { dev: d, iface: i, link: l };
      }
    }
    return undefined;
  }

  operUp(dev: Device, iface: Iface): boolean {
    if (!iface.adminUp) return false;
    if (iface.parent) {
      const p = findIface(dev, iface.parent);
      if (!p?.adminUp) return false;
      return this.copperUp(dev, iface.parent);
    }
    if (iface.name.toLowerCase().startsWith('vlan')) {
      return iface.adminUp;
    }
    if (iface.isRadio) {
      return iface.adminUp && (!!dev.associatedAp || dev.kind === 'ap');
    }
    return this.copperUp(dev, iface.name);
  }

  private copperUp(dev: Device, ifaceName: string): boolean {
    const p = this.peer(dev.id, ifaceName);
    if (!p || p.link.kind === 'radio') return false;
    return cableCarrier(p.link.cable, dev.kind, p.dev.kind).ok;
  }

  ifaceStatus(dev: Device, iface: Iface): { status: string; reason: string } {
    if (!iface.adminUp) return { status: 'Disabled', reason: 'administratively down' };
    if (iface.isRadio) {
      return this.operUp(dev, iface)
        ? { status: 'Up', reason: 'associated' }
        : { status: 'Unplugged', reason: 'not associated' };
    }
    const p = this.peer(dev.id, iface.parent ?? iface.name);
    if (!p || p.link.kind === 'radio') return { status: 'Unplugged', reason: 'no cable' };
    const carry = cableCarrier(p.link.cable, dev.kind, p.dev.kind);
    if (!carry.ok) return { status: 'Wrong cable', reason: carry.reason ?? 'wrong cable' };
    if (!this.operUp(dev, iface)) return { status: 'Down', reason: 'no carrier' };
    return { status: 'Up', reason: 'up' };
  }

  schedule(dt: number, run: () => void): void {
    this.q.push({ t: this.now + dt, run });
  }

  drain(max = 4000): void {
    let n = 0;
    while (this.q.length && n++ < max && !this.cancelled) {
      this.q.sort((a, b) => a.t - b.t);
      const e = this.q.shift();
      if (!e) break;
      this.now = e.t;
      e.run();
    }
  }

  private emitEvent(p: Omit<PacketEvent, 'id' | 't'>): PacketEvent {
    const ev: PacketEvent = { id: nid('e'), t: this.now, ...p };
    this.packets.push(ev);
    if (this.packets.length > 500) this.packets.shift();
    return ev;
  }

  recomputeStp(): void {
    this.warnings = this.warnings.filter((w) => !w.startsWith('RSTP-lite') && !w.startsWith('Broadcast loop'));
    for (const d of this.devices.values()) {
      d.blockedPorts = [];
      d.loopWarning = undefined;
    }
    const switches = [...this.devices.values()].filter((d) => d.kind === 'switch' || d.kind === 'ap');
    const vlans = new Set<number>([1]);
    for (const d of switches) for (const v of d.vlans) vlans.add(v);
    for (const d of switches) {
      for (const i of d.ifaces) {
        if (i.mode === 'access') vlans.add(i.accessVlan);
      }
    }
    for (const vlan of vlans) {
      type Edge = { a: Device; ai: string; b: Device; bi: string };
      const edges: Edge[] = [];
      for (const l of this.links) {
        if (l.kind !== 'copper') continue;
        const da = this.devices.get(l.a.deviceId);
        const db = this.devices.get(l.b.deviceId);
        if (!da || !db) continue;
        if (!this.portCarries(da, l.a.iface, vlan) || !this.portCarries(db, l.b.iface, vlan)) continue;
        if ((da.kind === 'switch' || da.kind === 'ap') && (db.kind === 'switch' || db.kind === 'ap')) {
          edges.push({ a: da, ai: l.a.iface, b: db, bi: l.b.iface });
        }
      }
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        parent.set(x, parent.get(x) ?? x);
        return parent.get(x) === x ? x : find(parent.get(x)!);
      };
      const union = (x: string, y: string): boolean => {
        const px = find(x);
        const py = find(y);
        if (px === py) return false;
        parent.set(px, py);
        return true;
      };
      edges.sort((e1, e2) => (e1.a.name + e1.ai).localeCompare(e2.a.name + e2.ai));
      for (const e of edges) {
        if (!union(e.a.id, e.b.id)) {
          const managedA = e.a.kind === 'ap' || isManagedSwitch(e.a);
          const managedB = e.b.kind === 'ap' || isManagedSwitch(e.b);
          const blocker = managedA !== managedB ? (managedA ? e.a : e.b) : e.a.name >= e.b.name ? e.a : e.b;
          const port = blocker === e.a ? e.ai : e.bi;
          if (!blocker.blockedPorts.includes(port)) blocker.blockedPorts.push(port);
          const noStp = !managedA && !managedB;
          const w = noStp
            ? `Broadcast loop detected between unmanaged switches; ${blocker.name} ${port} was suppressed because unmanaged switches do not run STP`
            : `RSTP-lite blocked ${blocker.name} ${port} to break a loop on VLAN ${vlan}`;
          if (!this.warnings.includes(w)) this.warnings.push(w);
          blocker.loopWarning = w;
        }
      }
    }
  }

  portCarries(dev: Device, ifaceName: string, vlan: number): boolean {
    const i = findIface(dev, ifaceName);
    if (!i) return false;
    if (switchProfileOf(dev) === 'unmanaged') return true;
    if (i.mode === 'access') return i.accessVlan === vlan;
    if (i.mode === 'trunk') return i.allowedVlans === 'all' || i.allowedVlans.includes(vlan);
    return true;
  }

  sendFrame(from: Device, fromIface: Iface, frame: Frame, reason: string): void {
    if (!fromIface.adminUp) {
      this.emitEvent({
        from: { device: from.name, iface: fromIface.name },
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        vlan: frame.vlan,
        ssid: frame.ssid,
        srcIp: frame.l3?.src,
        dstIp: frame.l3?.dst,
        proto: frame.arp ? 'ARP' : (frame.l3?.proto ?? frame.ethertype),
        ttl: frame.l3?.ttl,
        reason: `Interface ${fromIface.name} is administratively down`,
        drop: true,
      });
      return;
    }
    if (from.kind === 'switch' && fromIface.vlanId !== undefined) {
      const injected = { ...frame, vlan: fromIface.vlanId };
      this.emitEvent({
        from: { device: from.name, iface: fromIface.name },
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        vlan: fromIface.vlanId,
        srcIp: frame.l3?.src ?? frame.arp?.spa,
        dstIp: frame.l3?.dst ?? frame.arp?.tpa,
        proto: frame.arp ? 'ARP' : (frame.l3?.proto ?? frame.ethertype),
        ttl: frame.l3?.ttl,
        reason: `${reason}; injected into VLAN ${fromIface.vlanId}`,
      });
      for (const out of from.ifaces) {
        if (out.parent || out.vlanId !== undefined) continue;
        this.switchEgress(from, out.name, injected, fromIface.name);
      }
      return;
    }
    const physName = fromIface.parent ?? fromIface.name;
    const p = this.peer(from.id, physName);
    if (!p) {
      this.emitEvent({
        from: { device: from.name, iface: fromIface.name },
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        vlan: frame.vlan,
        srcIp: frame.l3?.src,
        dstIp: frame.l3?.dst,
        proto: frame.arp ? 'ARP' : (frame.l3?.proto ?? frame.ethertype),
        ttl: frame.l3?.ttl,
        reason: `No cable on ${physName}`,
        drop: true,
      });
      return;
    }
    this.emitEvent({
      from: { device: from.name, iface: fromIface.name },
      to: { device: p.dev.name, iface: p.iface.name },
      srcMac: frame.srcMac,
      dstMac: frame.dstMac,
      vlan: frame.vlan,
      ssid: frame.ssid ?? p.link.ssid,
      srcIp: frame.l3?.src ?? frame.arp?.spa,
      dstIp: frame.l3?.dst ?? frame.arp?.tpa,
      proto: frame.arp ? 'ARP' : (frame.l3?.proto ?? frame.ethertype),
      ttl: frame.l3?.ttl,
      reason,
      simulated: frame.l3?.proto === 'ssh' || frame.l3?.proto === 'ospf',
    });
    this.schedule(1, () => this.recvFrame(p.dev, p.iface, frame));
  }

  recvFrame(dev: Device, iface: Iface, frame: Frame): void {
    if (!iface.adminUp) {
      this.emitEvent({
        from: { device: dev.name, iface: iface.name },
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        vlan: frame.vlan,
        srcIp: frame.l3?.src,
        dstIp: frame.l3?.dst,
        proto: frame.l3?.proto ?? 'frame',
        reason: `Interface ${iface.name} is down`,
        drop: true,
      });
      return;
    }
    if (dev.blockedPorts.includes(iface.name)) {
      this.emitEvent({
        from: { device: dev.name, iface: iface.name },
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        vlan: frame.vlan,
        proto: frame.l3?.proto ?? 'frame',
        reason: dev.loopWarning ?? `RSTP-lite blocking ${dev.name} ${iface.name}`,
        drop: true,
      });
      return;
    }
    if (dev.kind === 'switch' && isMultilayerSwitch(dev) && iface.mode === 'routed') this.handleEnd(dev, iface, frame);
    else if (dev.kind === 'switch') this.handleSwitch(dev, iface, frame);
    else if (dev.kind === 'ap') this.handleAp(dev, iface, frame);
    else this.handleEnd(dev, iface, frame);
  }

  private classifyVlan(iface: Iface, frame: Frame): number | null {
    if (iface.mode === 'access') {
      if (frame.vlan !== undefined && frame.vlan !== iface.accessVlan) return null;
      return iface.accessVlan;
    }
    if (iface.mode === 'trunk') {
      const v = frame.vlan ?? iface.nativeVlan;
      if (iface.allowedVlans !== 'all' && !iface.allowedVlans.includes(v)) return null;
      return v;
    }
    return frame.vlan ?? iface.encapVlan ?? 1;
  }

  private handleSwitch(dev: Device, inIf: Iface, frame: Frame): void {
    if (switchProfileOf(dev) === 'unmanaged') {
      this.handleUnmanagedSwitch(dev, inIf, frame);
      return;
    }
    const vlan = this.classifyVlan(inIf, frame);
    if (vlan === null) {
      this.emitEvent({
        from: { device: dev.name, iface: inIf.name },
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        vlan: frame.vlan,
        proto: 'L2',
        reason: `VLAN mismatch on ${dev.name} ${inIf.name}`,
        drop: true,
      });
      return;
    }
    dev.macTable = dev.macTable.filter((m) => !(m.mac === frame.srcMac && m.vlan === vlan));
    dev.macTable.push({ mac: frame.srcMac, iface: inIf.name, vlan });
    const inner: Frame = { ...frame, vlan };
    const hit = frame.dstMac !== MAC_BCAST && !frame.dstMac.startsWith('01:') && !frame.dstMac.startsWith('33:33')
      ? dev.macTable.find((m) => m.mac === frame.dstMac && m.vlan === vlan)
      : undefined;
    const svi = findIface(dev, `Vlan${vlan}`);
    if (svi?.adminUp && this.macIsLocal(dev, frame.dstMac)) {
      this.handleEnd(dev, svi, inner);
      return;
    }
    if (hit) {
      if (hit.iface === inIf.name) return;
      this.switchEgress(dev, hit.iface, inner, inIf.name);
      return;
    }
    for (const i of dev.ifaces) {
      if (i.name === inIf.name) continue;
      if (i.parent || i.name.toLowerCase().startsWith('vlan')) continue;
      this.switchEgress(dev, i.name, inner, inIf.name);
    }
    if (svi?.adminUp && (frame.dstMac === MAC_BCAST || this.macIsLocal(dev, frame.dstMac))) {
      this.handleEnd(dev, svi, inner);
    }
  }

  private handleUnmanagedSwitch(dev: Device, inIf: Iface, frame: Frame): void {
    const vlanKey = frame.vlan ?? 1;
    dev.macTable = dev.macTable.filter((m) => !(m.mac === frame.srcMac && m.vlan === vlanKey));
    dev.macTable.push({ mac: frame.srcMac, iface: inIf.name, vlan: vlanKey });
    const hit =
      frame.dstMac !== MAC_BCAST && !frame.dstMac.startsWith('01:') && !frame.dstMac.startsWith('33:33')
        ? dev.macTable.find((m) => m.mac === frame.dstMac && m.vlan === vlanKey)
        : undefined;
    const outputs = hit && hit.iface !== inIf.name
      ? dev.ifaces.filter((i) => i.name === hit.iface)
      : dev.ifaces.filter((i) => i.name !== inIf.name && !i.parent && i.vlanId === undefined);
    for (const out of outputs) {
      if (!out.adminUp || dev.blockedPorts.includes(out.name)) continue;
      this.sendFrame(dev, out, { ...frame }, `Unmanaged switch ${dev.name} ${hit ? 'forward' : 'flood'} out ${out.name}`);
    }
  }

  private switchEgress(dev: Device, outName: string, frame: Frame, inName: string): void {
    const out = findIface(dev, outName);
    if (!out || out.name === inName) return;
    if (dev.blockedPorts.includes(out.name)) return;
    if (!out.adminUp) return;
    const vlan = frame.vlan ?? 1;
    if (out.mode === 'access') {
      if (out.accessVlan !== vlan) return;
      this.sendFrame(dev, out, { ...frame, vlan: undefined }, `Switch ${dev.name} flood/forward VLAN ${vlan} out ${out.name}`);
    } else if (out.mode === 'trunk') {
      if (out.allowedVlans !== 'all' && !out.allowedVlans.includes(vlan)) return;
      const tagged = vlan !== out.nativeVlan;
      this.sendFrame(
        dev,
        out,
        { ...frame, vlan: tagged ? vlan : undefined },
        `Switch ${dev.name} trunk VLAN ${vlan} out ${out.name}${tagged ? ' (802.1Q)' : ''}`,
      );
    }
  }

  private handleAp(dev: Device, inIf: Iface, frame: Frame): void {
    const ssid = dev.wifi[0] ?? (dev.wlans[0] ? { ssid: dev.wlans[0].ssid, vlan: dev.wlans[0].vlan, psk: dev.wlans[0].psk, channel: 6 } : undefined);
    const uplink = findIface(dev, 'Gi0/1');
    if (ssid && uplink && uplink.mode === 'access') uplink.accessVlan = ssid.vlan;
    if (inIf.isRadio) {
      const vlan = ssid?.vlan ?? 1;
      if (!uplink) return;
      this.sendFrame(
        dev,
        uplink,
        { ...frame, vlan, ssid: ssid?.ssid },
        `AP ${dev.name} bridged SSID ${ssid?.ssid ?? '?'} → VLAN ${vlan} (simplified BSS, simulated)`,
      );
      return;
    }
    const vlan = inIf.mode === 'access' ? (ssid?.vlan ?? inIf.accessVlan) : (this.classifyVlan(inIf, frame) ?? ssid?.vlan ?? 1);
    if (ssid && vlan === ssid.vlan) {
      const radio = findIface(dev, 'wlan0');
      if (radio?.adminUp) {
        this.sendFrame(
          dev,
          radio,
          { ...frame, ssid: ssid.ssid, vlan: undefined },
          `AP ${dev.name} bridged VLAN ${vlan} → SSID ${ssid.ssid} (simulated RF)`,
        );
      }
    }
  }

  private macIsLocal(dev: Device, mac: string): boolean {
    return dev.ifaces.some((i) => i.mac === mac);
  }

  private handleEnd(dev: Device, inIf: Iface, frame: Frame): void {
    if (inIf.encapVlan !== undefined) {
      const v = frame.vlan ?? 1;
      if (v !== inIf.encapVlan) return;
    } else if (inIf.parent) {
      return;
    } else if (dev.kind === 'router' || dev.kind === 'firewall') {
      const v = frame.vlan;
      if (v !== undefined) {
        const sub = dev.ifaces.find((i) => i.parent === inIf.name && i.encapVlan === v);
        if (sub) {
          this.handleEnd(dev, sub, frame);
          return;
        }
        if (v !== (inIf.nativeVlan ?? 1)) {
          this.emitEvent({
            from: { device: dev.name, iface: inIf.name },
            srcMac: frame.srcMac,
            dstMac: frame.dstMac,
            vlan: v,
            proto: 'L2',
            reason: `No subinterface for VLAN ${v} on ${dev.name} ${inIf.name}`,
            drop: true,
          });
          return;
        }
      }
    }
    const mine = this.macIsLocal(dev, frame.dstMac) || frame.dstMac === MAC_BCAST || frame.dstMac.startsWith('33:33') || frame.dstMac.startsWith('01:');
    if (!mine) {
      if (dev.forwarding && frame.l3) {
        /* fall through to L3 if promiscuous? no — routers only take own mac or bcast */
      }
      if (!this.macIsLocal(dev, frame.dstMac) && frame.dstMac !== MAC_BCAST && !frame.dstMac.startsWith('33:33') && !frame.dstMac.startsWith('01:')) {
        return;
      }
    }
    if (frame.arp) {
      this.handleArp(dev, inIf, frame);
      return;
    }
    if (frame.l3) this.handleL3(dev, inIf, frame.l3, frame);
  }

  private handleArp(dev: Device, inIf: Iface, frame: Frame): void {
    const arp = frame.arp!;
    if (arp.op === 'request') {
      const local = this.hasIpv4(dev, arp.tpa);
      if (local) {
        this.learnArp(dev, inIf.name, arp.spa, arp.sha);
        const reply: Frame = {
          id: nid('f'),
          srcMac: local.mac,
          dstMac: arp.sha,
          vlan: frame.vlan,
          ethertype: 'arp',
          arp: { op: 'reply', sha: local.mac, spa: arp.tpa, tha: arp.sha, tpa: arp.spa },
        };
        this.sendFrame(dev, inIf, reply, `ARP reply ${arp.tpa} is-at ${local.mac}`);
      }
      return;
    }
    this.learnArp(dev, inIf.name, arp.spa, arp.sha);
    const queued = this.pendingArp.filter((p) => p.devId === dev.id && p.ip === arp.spa);
    this.pendingArp = this.pendingArp.filter((p) => !(p.devId === dev.id && p.ip === arp.spa));
    for (const q of queued) {
      const iface = findIface(dev, q.iface);
      if (iface) this.sendL3On(dev, iface, q.pkt, arp.sha);
    }
  }

  private hasIpv4(dev: Device, ip: string): Iface | undefined {
    if (dev.kind === 'cloud' && (ip === '8.8.8.8' || ip === '1.1.1.1')) {
      return findIface(dev, 'eth0');
    }
    return dev.ifaces.find((i) => i.ipv4?.ip === ip);
  }

  private hasIpv6(dev: Device, ip: string): Iface | undefined {
    const a = parseIPv6(ip);
    if (!a) return undefined;
    return dev.ifaces.find((i) => i.ipv6.some((x) => {
      const b = parseIPv6(x.ip);
      return b && ipv6PrefixMatch(a, b, 128);
    }));
  }

  learnArp(dev: Device, iface: string, ip: string, mac: string): void {
    dev.arp = dev.arp.filter((e) => e.ip !== ip);
    dev.arp.push({ ip, mac, iface });
  }

  learnNdp(dev: Device, iface: string, ip: string, mac: string): void {
    dev.ndp = dev.ndp.filter((e) => e.ip !== ip);
    dev.ndp.push({ ip, mac, iface });
  }

  private rebuildConnected(dev: Device): void {
    dev.routesV4 = dev.routesV4.filter((r) => r.proto !== 'connected');
    dev.routesV6 = dev.routesV6.filter((r) => r.proto !== 'connected');
    for (const i of dev.ifaces) {
      if (!i.adminUp) continue;
      if (i.ipv4) {
        const net = formatIPv4(networkAddr(parseIPv4(i.ipv4.ip)!, i.ipv4.prefix));
        dev.routesV4.push({ dest: net, prefix: i.ipv4.prefix, iface: i.name, proto: 'connected', ad: 0 });
      }
      for (const v of i.ipv6) {
        if (v.ip.toLowerCase().startsWith('fe80')) {
          dev.routesV6.push({ dest: v.ip, prefix: 128, iface: i.name, proto: 'connected', ad: 0 });
          continue;
        }
        const p = parseIPv6(v.ip);
        if (!p) continue;
        dev.routesV6.push({ dest: formatIPv6(p), prefix: v.prefix, iface: i.name, proto: 'connected', ad: 0 });
      }
    }
    if (dev.kind === 'cloud') {
      dev.routesV4.push({ dest: '8.8.8.8', prefix: 32, iface: 'eth0', proto: 'connected', ad: 0 });
      dev.routesV4.push({ dest: '1.1.1.1', prefix: 32, iface: 'eth0', proto: 'connected', ad: 0 });
      dev.routesV4.push({ dest: '0.0.0.0', prefix: 0, iface: 'eth0', proto: 'static', ad: 1 });
    }
    if (dev.defaultGw4) {
      if (!dev.routesV4.some((r) => r.prefix === 0 && r.proto === 'static')) {
        const viaIface = this.ifaceForGw4(dev, dev.defaultGw4);
        dev.routesV4.push({ dest: '0.0.0.0', prefix: 0, nexthop: dev.defaultGw4, iface: viaIface, proto: 'static', ad: 1 });
      }
    }
    if (dev.defaultGw6) {
      if (!dev.routesV6.some((r) => r.prefix === 0)) {
        dev.routesV6.push({ dest: '::', prefix: 0, nexthop: dev.defaultGw6, proto: 'ra', ad: 2 });
      }
    }
  }

  private outIfaceV4(dev: Device, route: RouteV4, dst: string): Iface | undefined {
    if (route.iface) {
      const i = findIface(dev, route.iface);
      if (i) return i;
    }
    if (route.nexthop) {
      const n = this.ifaceForGw4(dev, route.nexthop);
      if (n) return findIface(dev, n);
    }
    return this.pickSrc4(dev, dst)?.iface;
  }

  private ifaceForGw4(dev: Device, gw: string): string | undefined {
    const g = parseIPv4(gw);
    if (g === null) return undefined;
    for (const i of dev.ifaces) {
      if (i.ipv4 && inSubnet(g, parseIPv4(i.ipv4.ip)!, i.ipv4.prefix)) return i.name;
    }
    return undefined;
  }

  /** Egress interface for an IPv6 next hop: the interface whose prefix contains it, or where its NDP entry was learnt (link-local gateways). */
  private ifaceForGw6(dev: Device, gw: string): Iface | undefined {
    const g = parseIPv6(gw);
    if (!g) return undefined;
    const nd = dev.ndp.find((e) => e.ip === gw);
    if (nd) return findIface(dev, nd.iface);
    for (const i of dev.ifaces) {
      for (const v of i.ipv6) {
        if (v.ip.toLowerCase().startsWith('fe80')) continue;
        const b = parseIPv6(v.ip);
        if (b && ipv6PrefixMatch(g, b, v.prefix)) return i;
      }
    }
    return undefined;
  }

  lookupV4(dev: Device, dst: string): RouteV4 | undefined {
    this.rebuildConnected(dev);
    const dip = parseIPv4(dst);
    if (dip === null) return undefined;
    let best: RouteV4 | undefined;
    for (const r of dev.routesV4) {
      const net = parseIPv4(r.dest);
      if (net === null) continue;
      if (!inSubnet(dip, net, r.prefix)) continue;
      if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && r.ad < best.ad)) best = r;
    }
    return best;
  }

  lookupV6(dev: Device, dst: string): RouteV6 | undefined {
    this.rebuildConnected(dev);
    const dip = parseIPv6(dst);
    if (!dip) return undefined;
    let best: RouteV6 | undefined;
    for (const r of dev.routesV6) {
      const net = parseIPv6(r.dest);
      if (!net) continue;
      if (!ipv6PrefixMatch(dip, net, r.prefix)) continue;
      if (!best || r.prefix > best.prefix || (r.prefix === best.prefix && r.ad < best.ad)) best = r;
    }
    return best;
  }

  pickSrc4(dev: Device, dst: string, hint?: string): { ip: string; iface: Iface } | undefined {
    if (hint) {
      const i = findIface(dev, hint);
      if (i?.ipv4) return { ip: i.ipv4.ip, iface: i };
    }
    const r = this.lookupV4(dev, dst);
    if (r?.iface) {
      const i = findIface(dev, r.iface);
      if (i?.ipv4) return { ip: i.ipv4.ip, iface: i };
    }
    const any = dev.ifaces.find((i) => i.ipv4 && i.adminUp);
    return any?.ipv4 ? { ip: any.ipv4.ip, iface: any } : undefined;
  }

  pickSrc6(dev: Device, dst: string): { ip: string; iface: Iface } | undefined {
    const dstB = parseIPv6(dst);
    const isLl = dst.toLowerCase().startsWith('fe80');
    if (isLl) {
      const i = dev.ifaces.find((x) => x.adminUp && x.ipv6.some((v) => v.ip.toLowerCase().startsWith('fe80')));
      const ll = i?.ipv6.find((v) => v.ip.toLowerCase().startsWith('fe80'));
      if (i && ll) return { ip: ll.ip, iface: i };
    }
    const r = this.lookupV6(dev, dst);
    if (r?.iface) {
      const i = findIface(dev, r.iface);
      const g = i?.ipv6.find((v) => !v.ip.toLowerCase().startsWith('fe80'));
      if (i && g) return { ip: g.ip, iface: i };
    }
    for (const i of dev.ifaces) {
      const g = i.ipv6.find((v) => !v.ip.toLowerCase().startsWith('fe80'));
      if (g && i.adminUp) return { ip: g.ip, iface: i };
    }
    if (dstB) {
      const i = dev.ifaces.find((x) => x.adminUp);
      const ll = i?.ipv6.find((v) => v.ip.toLowerCase().startsWith('fe80'));
      if (i && ll) return { ip: ll.ip, iface: i };
    }
    return undefined;
  }

  emitL3(dev: Device, pkt: L3Packet): void {
    if (pkt.family === 'v4' && this.hasIpv4(dev, pkt.dst)) {
      this.deliverLocal(dev, this.hasIpv4(dev, pkt.dst)!, pkt);
      return;
    }
    if (pkt.family === 'v6' && this.hasIpv6(dev, pkt.dst) && pkt.dst.toLowerCase() !== 'ff02::1') {
      this.deliverLocal(dev, this.hasIpv6(dev, pkt.dst)!, pkt);
      return;
    }
    if (pkt.family === 'v4' && (pkt.dst === '255.255.255.255' || pkt.dst === '224.0.0.5')) {
      const iface = dev.ifaces.find((i) => i.dhcpClient && i.adminUp) ?? dev.ifaces.find((i) => i.adminUp && !i.isRadio) ?? dev.ifaces[0];
      if (iface) this.sendL3On(dev, iface, pkt, pkt.dst === '224.0.0.5' ? '01:00:5e:00:00:05' : MAC_BCAST);
      return;
    }
    if (pkt.family === 'v4') this.forwardV4(dev, undefined, pkt, true);
    else this.forwardV6(dev, undefined, pkt, true);
  }

  private fwAllow(dev: Device, inIf: Iface | undefined, outIf: Iface | undefined, pkt: L3Packet, established: boolean): string | undefined {
    if (dev.kind !== 'firewall' && !this.aclDrop(dev, inIf, pkt)) return undefined;
    if (dev.kind !== 'firewall') return this.aclDrop(dev, inIf, pkt);
    if (established) return undefined;
    const srcZ = inIf?.zone;
    const dstZ = outIf?.zone;
    for (const r of dev.fwRules) {
      if (r.family && r.family !== 'any' && r.family !== pkt.family) continue;
      if (r.proto !== 'any' && r.proto !== pkt.proto && !(r.proto === 'icmp' && pkt.proto === 'icmp')) continue;
      if (r.srcZone && srcZ && r.srcZone !== srcZ) continue;
      if (r.dstZone && dstZ && r.dstZone !== dstZ) continue;
      if (r.src && !this.ipMatch(pkt.src, r.src, pkt.family)) continue;
      if (r.dst && !this.ipMatch(pkt.dst, r.dst, pkt.family)) continue;
      if (r.dport && pkt.dport !== r.dport) continue;
      if (r.action === 'deny') {
        return `ACL drop: deny ${pkt.proto} ${pkt.src} → ${pkt.dst}${r.dport ? ':' + r.dport : ''} (${r.srcZone ?? '*'}→${r.dstZone ?? '*'})`;
      }
      return undefined;
    }
    if (dev.fwPolicy === 'drop') {
      return `ACL drop: default policy drop ${pkt.proto} ${pkt.src} → ${pkt.dst}${pkt.dport ? ':' + pkt.dport : ''}`;
    }
    return undefined;
  }

  private aclDrop(dev: Device, inIf: Iface | undefined, pkt: L3Packet): string | undefined {
    if (!inIf) return undefined;
    const name = (inIf as Iface & { aclIn?: string }).aclIn;
    if (!name || !dev.acls[name]) return undefined;
    for (const r of dev.acls[name]) {
      if (r.proto !== 'any' && r.proto !== 'ip' && r.proto !== pkt.proto) continue;
      if (r.src !== 'any' && !this.ipMatch(pkt.src, r.src, pkt.family)) continue;
      if (r.dst !== 'any' && !this.ipMatch(pkt.dst, r.dst, pkt.family)) continue;
      if (r.dport && pkt.dport !== r.dport) continue;
      if (r.action === 'deny') return `ACL drop: deny ${pkt.proto} ${pkt.src} → ${pkt.dst}`;
      return undefined;
    }
    return undefined;
  }

  private ipMatch(ip: string, spec: string, family: Family): boolean {
    if (spec === 'any') return true;
    if (spec.includes('/')) {
      if (family === 'v4') {
        const c = parseCidrV4(spec);
        const n = parseIPv4(ip);
        return !!(c && n !== null && inSubnet(n, c.ip, c.prefix));
      }
      const c = parseCidrV6(spec);
      const n = parseIPv6(ip);
      return !!(c && n && ipv6PrefixMatch(n, c.ip, c.prefix));
    }
    return ip === spec;
  }

  private ctHit(dev: Device, pkt: L3Packet): ConnHit | undefined {
    const rev = dev.conntrack.find(
      (c) =>
        c.family === pkt.family &&
        c.proto === pkt.proto &&
        c.dst === pkt.src &&
        (c.snatSrc ? c.snatSrc === pkt.dst : c.src === pkt.dst) &&
        (c.dport === undefined || c.sport === pkt.dport),
    );
    if (rev) return { kind: 'rev', e: rev };
    const fwd = dev.conntrack.find(
      (c) => c.family === pkt.family && c.proto === pkt.proto && c.src === pkt.src && c.dst === pkt.dst && c.dport === pkt.dport,
    );
    if (fwd) return { kind: 'fwd', e: fwd };
    return undefined;
  }

  private natOut(dev: Device, pkt: L3Packet, outIf: Iface): L3Packet {
    if (pkt.family !== 'v4' || !outIf.ipv4) return pkt;
    const inside = dev.ifaces.some((i) => i.nat === 'inside');
    const outside = outIf.nat === 'outside' || (dev.kind === 'firewall' && outIf.zone && dev.masqueradeZones.includes(outIf.zone));
    if (!outside) return pkt;
    if (dev.kind === 'router' && (!inside || !dev.natOverloadIface)) return pkt;
    if (dev.kind === 'router' && dev.natAcl && dev.acls[dev.natAcl]) {
      const ok = dev.acls[dev.natAcl].some((r) => r.action === 'permit' && this.ipMatch(pkt.src, r.src, 'v4'));
      if (!ok) return pkt;
    }
    const snat = outIf.ipv4.ip;
    dev.conntrack.push({
      family: 'v4',
      proto: pkt.proto,
      src: pkt.src,
      dst: pkt.dst,
      sport: pkt.sport,
      dport: pkt.dport,
      snatSrc: snat,
      origSrc: pkt.src,
    });
    return { ...pkt, src: snat };
  }

  forwardV4(dev: Device, inIf: Iface | undefined, pkt: L3Packet, originating: boolean): void {
    const local = this.hasIpv4(dev, pkt.dst);
    if (local) {
      this.deliverLocal(dev, local, pkt);
      return;
    }
    if (!originating && !dev.forwarding) {
      this.emitEvent({
        from: { device: dev.name, iface: inIf?.name ?? '?' },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        ttl: pkt.ttl,
        srcMac: '',
        dstMac: '',
        reason: isMultilayerSwitch(dev)
          ? `IP routing is disabled on ${dev.name} (configure "ip routing")`
          : `${dev.name} is not a router (no L3 forwarding)`,
        drop: true,
      });
      return;
    }
    if (!originating) {
      pkt = { ...pkt, ttl: pkt.ttl - 1 };
      if (pkt.ttl <= 0) {
        this.emitEvent({
          from: { device: dev.name, iface: inIf?.name ?? '?' },
          srcIp: pkt.src,
          dstIp: pkt.dst,
          proto: 'icmp',
          ttl: 0,
          srcMac: '',
          dstMac: '',
          reason: `TTL expired at ${dev.name}`,
          drop: true,
        });
        if (this.traceHop) this.traceHop.from = this.pickSrc4(dev, pkt.src)?.ip;
        if (inIf && pkt.icmpType === 'echo-request') {
          const src = this.pickSrc4(dev, pkt.src);
          if (src) {
            this.emitL3(dev, {
              id: nid('p'),
              family: 'v4',
              src: src.ip,
              dst: pkt.src,
              proto: 'icmp',
              ttl: 64,
              icmpType: 'time-exceeded',
            });
          }
        }
        return;
      }
    }
    const ct = this.ctHit(dev, pkt);
    if (ct?.kind === 'rev' && ct.e.snatSrc) {
      pkt = { ...pkt, dst: ct.e.origSrc };
    }
    const route = this.lookupV4(dev, pkt.dst);
    if (!route) {
      this.emitEvent({
        from: { device: dev.name, iface: inIf?.name ?? '?' },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        ttl: pkt.ttl,
        srcMac: '',
        dstMac: '',
        reason: `No route to ${pkt.dst} on ${dev.name}`,
        drop: true,
      });
      return;
    }
    const out = this.outIfaceV4(dev, route, pkt.dst);
    if (!out) {
      this.emitEvent({
        from: { device: dev.name, iface: '?' },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        srcMac: '',
        dstMac: '',
        reason: `No outgoing interface for ${pkt.dst} on ${dev.name}`,
        drop: true,
      });
      return;
    }
    if (!out.adminUp) {
      this.emitEvent({
        from: { device: dev.name, iface: out.name },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        srcMac: '',
        dstMac: '',
        reason: `Interface ${out.name} is administratively down`,
        drop: true,
      });
      return;
    }
    const deny = this.fwAllow(dev, inIf, out, pkt, !!ct);
    if (deny) {
      this.emitEvent({
        from: { device: dev.name, iface: out.name },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        dport: pkt.dport,
        srcMac: '',
        dstMac: '',
        reason: deny,
        drop: true,
      });
      return;
    }
    if (!ct && !originating) {
      dev.conntrack.push({ family: 'v4', proto: pkt.proto, src: pkt.src, dst: pkt.dst, sport: pkt.sport, dport: pkt.dport, origSrc: pkt.src });
    }
    const sent = originating ? pkt : this.natOut(dev, pkt, out);
    const nh = route.nexthop ?? sent.dst;
    this.l2sendV4(dev, out, sent, nh);
  }

  private l2sendV4(dev: Device, out: Iface, pkt: L3Packet, nh: string): void {
    const arp = dev.arp.find((e) => e.ip === nh);
    if (arp) {
      this.sendL3On(dev, out, pkt, arp.mac);
      return;
    }
    this.pendingArp.push({ devId: dev.id, iface: out.name, ip: nh, pkt });
    const req: Frame = {
      id: nid('f'),
      srcMac: out.mac,
      dstMac: MAC_BCAST,
      vlan: out.encapVlan,
      ethertype: 'arp',
      arp: { op: 'request', sha: out.mac, spa: out.ipv4?.ip ?? pkt.src, tha: '00:00:00:00:00:00', tpa: nh },
    };
    this.sendFrame(dev, out, req, `ARP who-has ${nh} tell ${out.ipv4?.ip ?? pkt.src}`);
    this.schedule(80, () => {
      const still = this.pendingArp.some((p) => p.devId === dev.id && p.ip === nh && p.pkt.id === pkt.id);
      if (still) {
        this.pendingArp = this.pendingArp.filter((p) => !(p.devId === dev.id && p.ip === nh && p.pkt.id === pkt.id));
        this.emitEvent({
          from: { device: dev.name, iface: out.name },
          srcIp: pkt.src,
          dstIp: pkt.dst,
          proto: pkt.proto,
          srcMac: out.mac,
          dstMac: MAC_BCAST,
          reason: `ARP timeout for ${nh} at ${dev.name}`,
          drop: true,
        });
      }
    });
  }

  sendL3On(dev: Device, out: Iface, pkt: L3Packet, dstMac: string): void {
    const frame: Frame = {
      id: nid('f'),
      srcMac: out.mac,
      dstMac,
      vlan: out.encapVlan,
      ethertype: pkt.family === 'v6' ? 'ipv6' : 'ipv4',
      l3: pkt,
      ssid: out.isRadio ? dev.associatedSsid : undefined,
    };
    const why = `${pkt.proto} ${pkt.src} → ${pkt.dst} ttl/hlim ${pkt.ttl}`;
    this.sendFrame(dev, out, frame, why);
  }

  forwardV6(dev: Device, inIf: Iface | undefined, pkt: L3Packet, originating: boolean): void {
    if (pkt.dst.toLowerCase() === 'ff02::1' || pkt.icmpType === 'ra' || pkt.icmpType === 'rs') {
      if (inIf) this.deliverLocal(dev, inIf, pkt);
      return;
    }
    const local = this.hasIpv6(dev, pkt.dst);
    if (local) {
      this.deliverLocal(dev, local, pkt);
      return;
    }
    if (!originating && !dev.forwarding) {
      this.emitEvent({
        from: { device: dev.name, iface: inIf?.name ?? '?' },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        srcMac: '',
        dstMac: '',
        reason: isMultilayerSwitch(dev)
          ? `IP routing is disabled on ${dev.name} (configure "ip routing")`
          : `${dev.name} is not a router`,
        drop: true,
      });
      return;
    }
    if (!originating) {
      pkt = { ...pkt, ttl: pkt.ttl - 1 };
      if (pkt.ttl <= 0) {
        this.emitEvent({
          from: { device: dev.name, iface: inIf?.name ?? '?' },
          srcIp: pkt.src,
          dstIp: pkt.dst,
          proto: 'icmp6',
          ttl: 0,
          srcMac: '',
          dstMac: '',
          reason: `Hop limit expired at ${dev.name}`,
          drop: true,
        });
        if (this.traceHop) this.traceHop.from = this.pickSrc6(dev, pkt.src)?.ip;
        return;
      }
    }
    let route = this.lookupV6(dev, pkt.dst);
    if (!route && pkt.dst.toLowerCase().startsWith('fe80')) {
      // Link-local destinations are on-link by definition: answer on the interface we learnt the peer from
      // (or the one the packet came in on), never through a router.
      const viaNdp = dev.ndp.find((e) => e.ip === pkt.dst)?.iface;
      const onLink = (viaNdp ? findIface(dev, viaNdp) : undefined) ?? inIf ?? dev.ifaces.find((i) => i.adminUp && !i.isRadio && i.ipv6.length > 0);
      if (onLink) route = { dest: 'fe80::', prefix: 10, iface: onLink.name, proto: 'connected', ad: 0 };
    }
    if (!route) {
      this.emitEvent({
        from: { device: dev.name, iface: inIf?.name ?? '?' },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        srcMac: '',
        dstMac: '',
        reason: `No route to ${pkt.dst} on ${dev.name}`,
        drop: true,
      });
      return;
    }
    const out = route.iface ? findIface(dev, route.iface) : (route.nexthop ? this.ifaceForGw6(dev, route.nexthop) : undefined) ?? this.pickSrc6(dev, pkt.dst)?.iface;
    if (!out?.adminUp) {
      this.emitEvent({
        from: { device: dev.name, iface: out?.name ?? '?' },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        srcMac: '',
        dstMac: '',
        reason: `Interface ${out?.name ?? '?'} is administratively down`,
        drop: true,
      });
      return;
    }
    const deny = this.fwAllow(dev, inIf, out, pkt, false);
    if (deny) {
      this.emitEvent({
        from: { device: dev.name, iface: out.name },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        srcMac: '',
        dstMac: '',
        reason: deny,
        drop: true,
      });
      return;
    }
    const nh = route.nexthop ?? pkt.dst;
    const nd = dev.ndp.find((e) => e.ip === nh);
    if (nd) {
      this.sendL3On(dev, out, pkt, nd.mac);
      return;
    }
    this.pendingNs.push({ devId: dev.id, iface: out.name, ip: nh, pkt });
    const ns: L3Packet = {
      id: nid('p'),
      family: 'v6',
      src: out.ipv6.find((v) => v.ip.toLowerCase().startsWith('fe80'))?.ip ?? pkt.src,
      dst: nh,
      proto: 'ndp',
      ttl: 255,
      icmpType: 'ns',
    };
    this.sendL3On(dev, out, ns, '33:33:ff:00:00:01');
    this.schedule(80, () => {
      const still = this.pendingNs.some((p) => p.pkt.id === pkt.id);
      if (still) {
        this.pendingNs = this.pendingNs.filter((p) => p.pkt.id !== pkt.id);
        this.emitEvent({
          from: { device: dev.name, iface: out.name },
          srcIp: pkt.src,
          dstIp: pkt.dst,
          proto: pkt.proto,
          srcMac: '',
          dstMac: '',
          reason: `NDP timeout for ${nh} at ${dev.name}`,
          drop: true,
        });
      }
    });
  }

  handleL3(dev: Device, inIf: Iface, pkt: L3Packet, _frame: Frame): void {
    if (pkt.family === 'v6' && pkt.icmpType === 'ns') {
      const local = this.hasIpv6(dev, pkt.dst);
      if (local) {
        this.learnNdp(dev, inIf.name, pkt.src, _frame.srcMac);
        const na: L3Packet = {
          id: nid('p'),
          family: 'v6',
          src: pkt.dst,
          dst: pkt.src,
          proto: 'ndp',
          ttl: 255,
          icmpType: 'na',
        };
        this.sendL3On(dev, inIf, na, _frame.srcMac);
      }
      return;
    }
    if (pkt.family === 'v6' && pkt.icmpType === 'na') {
      this.learnNdp(dev, inIf.name, pkt.src, _frame.srcMac);
      const queued = this.pendingNs.filter((p) => p.devId === dev.id && p.ip === pkt.src);
      this.pendingNs = this.pendingNs.filter((p) => !(p.devId === dev.id && p.ip === pkt.src));
      for (const q of queued) {
        const iface = findIface(dev, q.iface);
        if (iface) this.sendL3On(dev, iface, q.pkt, _frame.srcMac);
      }
      return;
    }
    if (pkt.icmpType === 'ra') {
      // The RA's link-local source becomes the default gateway; remember which port it came from so routed traffic leaves there.
      this.learnNdp(dev, inIf.name, pkt.src, _frame.srcMac);
      this.applyRa(dev, inIf, pkt);
      return;
    }
    if (pkt.icmpType === 'rs' && (dev.kind === 'router' || dev.kind === 'firewall')) {
      this.sendRa(dev, inIf);
      return;
    }
    const local4 = pkt.family === 'v4' ? this.hasIpv4(dev, pkt.dst) : undefined;
    const local6 = pkt.family === 'v6' ? this.hasIpv6(dev, pkt.dst) : undefined;
    if (
      local4 ||
      local6 ||
      pkt.proto === 'ospf' ||
      pkt.dst.toLowerCase() === '255.255.255.255' ||
      pkt.dst === '224.0.0.5' ||
      pkt.dst.endsWith('.255')
    ) {
      this.deliverLocal(dev, inIf, pkt);
      return;
    }
    if (pkt.family === 'v4') this.forwardV4(dev, inIf, pkt, false);
    else this.forwardV6(dev, inIf, pkt, false);
  }

  deliverLocal(dev: Device, inIf: Iface, pkt: L3Packet): void {
    if (pkt.proto === 'icmp' && pkt.icmpType === 'echo-request') {
      if (this.echoWait && pkt.icmpId === this.echoWait.id && pkt.icmpSeq === this.echoWait.seq) {
        /* dest will reply */
      }
      const reply: L3Packet = {
        id: nid('p'),
        family: 'v4',
        src: pkt.dst,
        dst: pkt.src,
        proto: 'icmp',
        ttl: 64,
        icmpType: 'echo-reply',
        icmpId: pkt.icmpId,
        icmpSeq: pkt.icmpSeq,
      };
      this.emitEvent({
        from: { device: dev.name, iface: inIf.name },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: 'icmp',
        ttl: pkt.ttl,
        srcMac: '',
        dstMac: '',
        reason: `ICMP echo request delivered to ${dev.name}`,
      });
      this.emitL3(dev, reply);
      return;
    }
    if (pkt.proto === 'icmp6' && pkt.icmpType === 'echo-request') {
      const reply: L3Packet = {
        id: nid('p'),
        family: 'v6',
        src: pkt.dst,
        dst: pkt.src,
        proto: 'icmp6',
        ttl: 64,
        icmpType: 'echo-reply',
        icmpId: pkt.icmpId,
        icmpSeq: pkt.icmpSeq,
      };
      this.emitEvent({
        from: { device: dev.name, iface: inIf.name },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: 'icmp6',
        ttl: pkt.ttl,
        srcMac: '',
        dstMac: '',
        reason: `ICMPv6 echo request delivered to ${dev.name}`,
      });
      this.emitL3(dev, reply);
      return;
    }
    if ((pkt.proto === 'icmp' || pkt.proto === 'icmp6') && pkt.icmpType === 'echo-reply') {
      if (this.echoWait && pkt.icmpId === this.echoWait.id && pkt.icmpSeq === this.echoWait.seq) this.echoWait.got = true;
      this.emitEvent({
        from: { device: dev.name, iface: inIf.name },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: pkt.proto,
        ttl: pkt.ttl,
        srcMac: '',
        dstMac: '',
        reason: `ICMP echo reply from ${pkt.src}`,
      });
      return;
    }
    if ((pkt.proto === 'icmp' || pkt.proto === 'icmp6') && pkt.icmpType === 'time-exceeded') {
      if (this.traceHop) this.traceHop.from = pkt.src;
      return;
    }
    if (pkt.proto === 'dhcp' || (pkt.proto === 'udp' && (pkt.dport === 67 || pkt.dport === 68))) {
      this.handleDhcp(dev, inIf, pkt);
      return;
    }
    if (pkt.proto === 'dns' || (pkt.proto === 'udp' && pkt.dport === 53)) {
      this.handleDns(dev, pkt);
      return;
    }
    if (pkt.proto === 'ospf') {
      this.handleOspfHello(dev, inIf, pkt);
      return;
    }
    if (pkt.proto === 'tcp' && pkt.dport === 22) {
      const allow = dev.sshListen || dev.kind === 'server' || (dev.kind === 'workstation' && dev.sshEnabled);
      this.emitEvent({
        from: { device: dev.name, iface: inIf.name },
        srcIp: pkt.src,
        dstIp: pkt.dst,
        proto: 'ssh',
        ttl: pkt.ttl,
        srcMac: '',
        dstMac: '',
        reason: allow
          ? `SSH (simulated) login shell on ${dev.name}:22`
          : `TCP/22 closed on ${dev.name}`,
        drop: !allow,
        simulated: true,
      });
      if (allow && this.echoWait) this.echoWait.got = true;
      return;
    }
    this.emitEvent({
      from: { device: dev.name, iface: inIf.name },
      srcIp: pkt.src,
      dstIp: pkt.dst,
      proto: pkt.proto,
      ttl: pkt.ttl,
      srcMac: '',
      dstMac: '',
      reason: `Delivered to ${dev.name} ${inIf.name}`,
    });
  }

  handleDhcp(dev: Device, inIf: Iface, pkt: L3Packet): void {
    const msg = String(pkt.payload?.['msg'] ?? '');
    const mac = String(pkt.payload?.['mac'] ?? '');
    const relayIp = String(pkt.payload?.['relayIp'] ?? '');
    const relayIface = String(pkt.payload?.['relayIface'] ?? '');

    // A relay receives the server's unicast response and rebroadcasts it in the client VLAN.
    if ((msg === 'offer' || msg === 'ack') && relayIp && this.hasIpv4(dev, relayIp)) {
      const clientSide = findIface(dev, relayIface) ?? this.hasIpv4(dev, relayIp);
      if (clientSide) {
        this.sendL3On(
          dev,
          clientSide,
          { ...pkt, id: nid('p'), src: relayIp, dst: '255.255.255.255' },
          MAC_BCAST,
        );
      }
      return;
    }

    if (
      (msg === 'discover' || msg === 'request') &&
      inIf.helperAddress &&
      inIf.ipv4 &&
      !this.dhcpPoolFor(dev, inIf, relayIp)
    ) {
      this.emitL3(dev, {
        ...pkt,
        id: nid('p'),
        src: inIf.ipv4.ip,
        dst: inIf.helperAddress,
        payload: { ...pkt.payload, relayIp: inIf.ipv4.ip, relayIface: inIf.name },
      });
      return;
    }

    if (msg === 'discover' && dev.dhcpPools.length) {
      const pool = this.dhcpPoolFor(dev, inIf, relayIp);
      if (!pool?.network || pool.prefix === undefined) return;
      const ipn = this.nextDhcp(dev, { network: pool.network, prefix: pool.prefix });
      if (!ipn) return;
      const responseDst = relayIp || '255.255.255.255';
      const serverSource = (relayIp ? this.pickSrc4(dev, relayIp)?.ip : inIf.ipv4?.ip) ??
        formatIPv4(networkAddr(parseIPv4(pool.network)!, pool.prefix) + 1);
      const offer: L3Packet = {
        id: nid('p'),
        family: 'v4',
        src: serverSource,
        dst: responseDst,
        proto: 'dhcp',
        ttl: 64,
        sport: 67,
        dport: 68,
        payload: {
          msg: 'offer',
          ip: ipn,
          mask: formatIPv4(prefixToMask(pool.prefix)),
          gw: pool.gateway ?? inIf.ipv4?.ip,
          dns: pool.dns,
          mac,
          iface: pkt.payload?.['iface'],
          ...(relayIp ? { relayIp, relayIface } : {}),
        },
      };
      if (relayIp) this.emitL3(dev, offer);
      else this.sendL3On(dev, inIf, offer, MAC_BCAST);
      return;
    }
    if (msg === 'request' && dev.dhcpPools.length) {
      const pool = this.dhcpPoolFor(dev, inIf, relayIp);
      if (!pool) return;
      const responseDst = relayIp || '255.255.255.255';
      const ack: L3Packet = {
        ...pkt,
        id: nid('p'),
        src: (relayIp ? this.pickSrc4(dev, relayIp)?.ip : inIf.ipv4?.ip) ?? pkt.src,
        dst: responseDst,
        dport: 68,
        sport: 67,
        payload: { ...pkt.payload, msg: 'ack' },
      };
      const leased = String(pkt.payload?.['ip'] ?? '');
      if (leased && mac) {
        dev.dhcpBindings = dev.dhcpBindings.filter((b) => b.mac !== mac);
        dev.dhcpBindings.push({ mac, ip: leased, iface: relayIface || inIf.name });
      }
      if (relayIp) this.emitL3(dev, ack);
      else this.sendL3On(dev, inIf, ack, MAC_BCAST);
      return;
    }
    if ((msg === 'discover' || msg === 'request') && inIf.helperAddress && inIf.ipv4) {
      const relayed: L3Packet = {
        ...pkt,
        id: nid('p'),
        src: inIf.ipv4.ip,
        dst: inIf.helperAddress,
        payload: { ...pkt.payload, relayIp: inIf.ipv4.ip, relayIface: inIf.name },
      };
      this.emitL3(dev, relayed);
      return;
    }
    if (msg === 'offer') {
      if (!dev.ifaces.some((i) => i.mac === mac)) return;
      const req: L3Packet = {
        id: nid('p'),
        family: 'v4',
        src: '0.0.0.0',
        dst: '255.255.255.255',
        proto: 'dhcp',
        ttl: 64,
        sport: 68,
        dport: 67,
        payload: { ...pkt.payload, msg: 'request' },
      };
      this.emitL3(dev, req);
      return;
    }
    if (msg === 'ack') {
      if (!dev.ifaces.some((i) => i.mac === mac)) return;
      const ip = String(pkt.payload?.['ip'] ?? '');
      const ifaceName = String(pkt.payload?.['iface'] ?? dev.ifaces.find((i) => i.dhcpClient)?.name ?? 'eth0');
      const iface = findIface(dev, ifaceName) ?? dev.ifaces[0];
      const mask = String(pkt.payload?.['mask'] ?? '255.255.255.0');
      const prefix = parseMaskOrPrefix(mask) ?? 24;
      iface.ipv4 = { ip, prefix };
      const gw = String(pkt.payload?.['gw'] ?? '');
      if (gw) dev.defaultGw4 = gw;
      const dns = String(pkt.payload?.['dns'] ?? '');
      if (dns) dev.dnsServers = [dns];
      this.rebuildConnected(dev);
    }
  }

  private dhcpOnIface(dev: Device): boolean {
    return dev.dhcpPools.length > 0;
  }

  private dhcpPoolFor(dev: Device, inIf: Iface, relayIp?: string) {
    const target = parseIPv4(relayIp || inIf.ipv4?.ip || '');
    if (target !== null) {
      const matched = dev.dhcpPools.find((pool) => {
        const network = pool.network ? parseIPv4(pool.network) : null;
        return network !== null && pool.prefix !== undefined && inSubnet(target, network, pool.prefix);
      });
      if (matched) return matched;
    }
    return dev.dhcpPools.length === 1 ? dev.dhcpPools[0] : undefined;
  }

  private implicitPool(dev: Device, inIf: Iface): { network: string; prefix: number; gateway?: string } | undefined {
    if (!inIf.ipv4) return undefined;
    return {
      network: formatIPv4(networkAddr(parseIPv4(inIf.ipv4.ip)!, inIf.ipv4.prefix)),
      prefix: inIf.ipv4.prefix,
      gateway: inIf.ipv4.ip,
    };
  }

  private nextDhcp(dev: Device, pool: { network: string; prefix: number }): string | undefined {
    const net = parseIPv4(pool.network)!;
    const start = net + 10;
    const end = broadcastAddr(net, pool.prefix) - 1;
    const used = new Set<string>();
    for (const d of this.devices.values()) {
      for (const i of d.ifaces) if (i.ipv4) used.add(i.ipv4.ip);
    }
    for (let n = start; n <= end; n++) {
      const ip = formatIPv4(n);
      const excluded = dev.dhcpExcluded.some((range) => {
        const a = parseIPv4(range.start);
        const b = parseIPv4(range.end);
        return a !== null && b !== null && n >= a && n <= b;
      });
      if (!used.has(ip) && !excluded) return ip;
    }
    return undefined;
  }

  handleDns(dev: Device, pkt: L3Packet): void {
    const name = String(pkt.payload?.['q'] ?? '');
    let rec = dev.dnsRecords[name];
    if (!rec) {
      for (const d of this.devices.values()) {
        if (d.dnsRecords[name]) rec = d.dnsRecords[name];
      }
    }
    const a = rec?.a;
    const ans: L3Packet = {
      id: nid('p'),
      family: pkt.family,
      src: pkt.dst,
      dst: pkt.src,
      proto: 'dns',
      ttl: 64,
      sport: 53,
      dport: pkt.sport,
      payload: { q: name, a, aaaa: rec?.aaaa },
    };
    this.emitL3(dev, ans);
  }

  applyRa(dev: Device, inIf: Iface, pkt: L3Packet): void {
    if (dev.kind !== 'workstation' && dev.kind !== 'server') return;
    const prefix = String(pkt.payload?.['prefix'] ?? '');
    const plen = Number(pkt.payload?.['plen'] ?? 64);
    if (!prefix) return;
    const addr = slaacAddress(`${prefix}/${plen}`, inIf.mac);
    if (!addr) return;
    if (!inIf.ipv6.some((v) => v.ip === addr)) {
      inIf.ipv6.push({ ip: addr, prefix: plen, slaac: true });
    }
    dev.defaultGw6 = pkt.src;
    const dns = String(pkt.payload?.['dns'] ?? '');
    if (dns) dev.dnsServers = [...new Set([...dev.dnsServers, dns])];
    this.rebuildConnected(dev);
    this.emitEvent({
      from: { device: dev.name, iface: inIf.name },
      srcIp: pkt.src,
      dstIp: pkt.dst,
      proto: 'ra',
      srcMac: '',
      dstMac: '',
      reason: `SLAAC ${addr}/${plen} on ${dev.name} ${inIf.name} via RA`,
      simulated: false,
    });
  }

  sendRa(dev: Device, iface: Iface): void {
    const glob = iface.ipv6.find((v) => !v.ip.toLowerCase().startsWith('fe80'));
    if (!glob || iface.raSuppress) return;
    const ll = iface.ipv6.find((v) => v.ip.toLowerCase().startsWith('fe80'));
    const cidr = iface.raPrefix?.cidr ?? glob.ip;
    const plen = iface.raPrefix?.prefix ?? glob.prefix;
    const ra: L3Packet = {
      id: nid('p'),
      family: 'v6',
      src: ll?.ip ?? glob.ip,
      dst: 'ff02::1',
      proto: 'ra',
      ttl: 255,
      icmpType: 'ra',
      payload: { prefix: cidr.split('/')[0], plen, dns: dev.dnsServers[0] },
    };
    this.sendL3On(dev, iface, ra, '33:33:00:00:00:01');
  }

  handleOspfHello(dev: Device, inIf: Iface, pkt: L3Packet): void {
    if (!dev.ospf.enabled) return;
    const rid = String(pkt.payload?.['rid'] ?? '');
    const area = String(pkt.payload?.['area'] ?? '0');
    if (!rid || rid === this.routerId(dev)) return;
    let n = dev.ospf.neighbors.find((x) => x.routerId === rid);
    if (!n) {
      n = { routerId: rid, state: 'Init', iface: inIf.name, peerIp: pkt.src, area };
      dev.ospf.neighbors.push(n);
    }
    n.state = 'FULL';
    n.peerIp = pkt.src;
  }

  routerId(dev: Device): string {
    if (dev.ospf.routerId) return dev.ospf.routerId;
    let best = 0;
    for (const i of dev.ifaces) {
      if (i.ipv4) best = Math.max(best, parseIPv4(i.ipv4.ip)!);
    }
    return formatIPv4(best);
  }

  private enableOspfIfaces(dev: Device): void {
    for (const i of dev.ifaces) i.ospfEnabled = false;
    if (!dev.ospf.enabled) return;
    for (const n of dev.ospf.networks) {
      const net = parseIPv4(n.network);
      const wild = parseIPv4(n.wildcard);
      if (net === null || wild === null) continue;
      const mask = (~wild) >>> 0;
      for (const i of dev.ifaces) {
        if (!i.ipv4) continue;
        const ip = parseIPv4(i.ipv4.ip)!;
        if (((ip & mask) >>> 0) === ((net & mask) >>> 0)) i.ospfEnabled = true;
      }
    }
  }

  convergeOspf(): void {
    const routers = [...this.devices.values()].filter((d) => d.kind === 'router' || d.kind === 'firewall');
    for (const r of routers) this.enableOspfIfaces(r);
    for (const r of routers) {
      if (!r.ospf.enabled) continue;
      for (const i of r.ifaces) {
        if (!i.ospfEnabled || !i.ipv4 || !i.adminUp) continue;
        const hello: L3Packet = {
          id: nid('p'),
          family: 'v4',
          src: i.ipv4.ip,
          dst: '224.0.0.5',
          proto: 'ospf',
          ttl: 1,
          payload: { rid: this.routerId(r), area: '0' },
        };
        this.sendL3On(r, i, hello, '01:00:5e:00:00:05');
      }
    }
    this.drain();
    for (const a of routers) {
      if (!a.ospf.enabled) continue;
      for (const b of routers) {
        if (a.id === b.id || !b.ospf.enabled) continue;
        for (const ia of a.ifaces) {
          if (!ia.ospfEnabled || !ia.ipv4) continue;
          for (const ib of b.ifaces) {
            if (!ib.ospfEnabled || !ib.ipv4) continue;
            const pa = parseIPv4(ia.ipv4.ip)!;
            if (!inSubnet(parseIPv4(ib.ipv4.ip)!, networkAddr(pa, ia.ipv4.prefix), ia.ipv4.prefix)) continue;
            const na = a.ospf.neighbors.find((n) => n.routerId === this.routerId(b));
            const nb = b.ospf.neighbors.find((n) => n.routerId === this.routerId(a));
            if (na) {
              na.state = 'FULL';
              na.peerIp = ib.ipv4.ip;
              na.iface = ia.name;
            } else {
              a.ospf.neighbors.push({
                routerId: this.routerId(b),
                state: 'FULL',
                iface: ia.name,
                peerIp: ib.ipv4.ip,
                area: '0',
              });
            }
            if (nb) {
              nb.state = 'FULL';
              nb.peerIp = ia.ipv4.ip;
            }
          }
        }
      }
    }
    for (const r of routers) {
      if (!r.ospf.enabled) continue;
      r.ospf.lsdb = [];
      for (const x of routers) {
        if (!x.ospf.enabled) continue;
        const prefixes: OspfLsa['prefixes'] = [];
        for (const i of x.ifaces) {
          if (!i.ipv4) continue;
          if (!i.ospfEnabled && i.ipv4.prefix === 32) continue;
          if (i.ospfEnabled || i.adminUp) {
            prefixes.push({
              dest: formatIPv4(networkAddr(parseIPv4(i.ipv4.ip)!, i.ipv4.prefix)),
              prefix: i.ipv4.prefix,
              metric: 1,
              nexthopHint: i.ipv4.ip,
            });
          }
        }
        r.ospf.lsdb.push({ type: 1, id: this.routerId(x), adv: this.routerId(x), seq: 1, prefixes });
      }
    }
    for (const r of routers) {
      if (!r.ospf.enabled) continue;
      r.routesV4 = r.routesV4.filter((x) => x.proto !== 'ospf');
      const nhFor: Record<string, string> = {};
      for (const n of r.ospf.neighbors) {
        if (n.state === 'FULL') nhFor[n.routerId] = n.peerIp;
      }
      for (const lsa of r.ospf.lsdb) {
        if (lsa.adv === this.routerId(r)) continue;
        const nh = nhFor[lsa.adv];
        if (!nh) continue;
        const via = r.ifaces.find((i) => i.ospfEnabled && i.ipv4 && inSubnet(parseIPv4(nh)!, parseIPv4(i.ipv4.ip)!, i.ipv4.prefix));
        for (const p of lsa.prefixes) {
          if (r.ifaces.some((i) => i.ipv4 && formatIPv4(networkAddr(parseIPv4(i.ipv4.ip)!, i.ipv4.prefix)) === p.dest && i.ipv4.prefix === p.prefix)) {
            continue;
          }
          r.routesV4.push({
            dest: p.dest,
            prefix: p.prefix,
            nexthop: nh,
            iface: via?.name,
            proto: 'ospf',
            ad: 110,
            metric: p.metric,
          });
        }
      }
    }
  }

  converge(): void {
    for (const d of this.devices.values()) {
      this.syncWlc(d);
      this.rebuildConnected(d);
    }
    for (const d of this.devices.values()) {
      if (d.kind === 'router' || d.kind === 'firewall') {
        for (const i of d.ifaces) {
          if (i.ipv6.some((v) => !v.ip.toLowerCase().startsWith('fe80')) && !i.raSuppress && i.adminUp) {
            this.sendRa(d, i);
          }
        }
      }
    }
    this.drain();
    this.convergeOspf();
    this.drain();
  }

  syncWlc(ap: Device): void {
    if (ap.kind !== 'ap' || !ap.capwapController) return;
    const ip = ap.capwapController;
    const wlc = [...this.devices.values()].find((d) => d.kind === 'wlc' && this.hasIpv4(d, ip));
    if (!wlc) return;
    ap.joinedWlc = wlc.name;
    if (wlc.wlans.length) {
      ap.wifi = wlc.wlans.map((w) => ({ ssid: w.ssid, vlan: w.vlan, psk: w.psk, channel: ap.wifi[0]?.channel ?? 6 }));
    }
  }

  associateWifi(client: Device, ssid: string, psk?: string): string {
    const aps = [...this.devices.values()].filter((d) => d.kind === 'ap');
    let match: { ap: Device; conf: { ssid: string; vlan: number; psk?: string; channel: number } } | undefined;
    for (const ap of aps) {
      this.syncWlc(ap);
      for (const w of ap.wifi) {
        if (w.ssid === ssid) {
          match = { ap, conf: w };
          break;
        }
      }
    }
    if (!match) return `SSID ${ssid} not found (no AP in range — simplified BSS)`;
    const radio = findIface(match.ap, 'wlan0');
    const cr = findIface(client, 'wlan0');
    if (!radio?.adminUp) return `AP ${match.ap.name} radio is down`;
    if (!cr) return `No wlan0 on ${client.name}`;
    if (match.conf.psk && match.conf.psk !== psk) return `WPA2-PSK mismatch for ${ssid}`;
    this.links = this.links.filter((l) => !(l.kind === 'radio' && (l.a.deviceId === client.id || l.b.deviceId === client.id)));
    cr.adminUp = true;
    cr.accessVlan = match.conf.vlan;
    client.associatedSsid = ssid;
    client.associatedAp = match.ap.id;
    this.links.push({
      id: nid('R'),
      a: { deviceId: client.id, iface: 'wlan0' },
      b: { deviceId: match.ap.id, iface: 'wlan0' },
      kind: 'radio',
      ssid,
    });
    this.logActivity(`${client.name} associated SSID ${ssid} on ${match.ap.name}`);
    return `Associated to ${ssid} on ${match.ap.name} (VLAN ${match.conf.vlan}, channel ${match.conf.channel} cosmetic except same-SSID/same-channel BSS)`;
  }

  /** Name → address. On a dual-stack peer `prefer` decides which family wins (ping6 / a v6 check asks for v6). */
  resolveName(dev: Device, host: string, prefer?: Family): { ip?: string; family?: Family; err?: string } {
    if (isIPv4Literal(host)) return { ip: host, family: 'v4' };
    if (isIPv6Literal(host)) return { ip: host, family: 'v6' };
    if (dev.hostsFile[host]) return this.resolveName(dev, dev.hostsFile[host], prefer);
    const peer = this.find(host);
    if (peer) {
      const ip = peer.ifaces.find((i) => i.ipv4)?.ipv4?.ip;
      const ip6 = peer.ifaces.find((i) => i.ipv6.some((v) => !v.ip.toLowerCase().startsWith('fe80')))?.ipv6.find((v) => !v.ip.toLowerCase().startsWith('fe80'))?.ip;
      if (prefer === 'v6' && ip6) return { ip: ip6, family: 'v6' };
      if (ip) return { ip, family: 'v4' };
      if (ip6) return { ip: ip6, family: 'v6' };
    }
    for (const d of this.devices.values()) {
      const rec = d.dnsRecords[host];
      if (prefer === 'v6' && rec?.aaaa) return { ip: rec.aaaa, family: 'v6' };
      if (rec?.a) return { ip: rec.a, family: 'v4' };
      if (rec?.aaaa) return { ip: rec.aaaa, family: 'v6' };
    }
    return { err: `cannot resolve ${host}` };
  }

  ping(srcName: string, dst: string, opts: { count?: number; family?: Family; ttl?: number } = {}): PingResult {
    const src = this.dev(srcName);
    const start = this.packets.length;
    const resolved = this.resolveName(src, dst, opts.family);
    if (resolved.err || !resolved.ip) {
      return { ok: false, output: `ping: ${resolved.err}`, reason: resolved.err ?? 'unresolved', events: [], rttMs: [] };
    }
    const family = opts.family ?? resolved.family ?? 'v4';
    const count = opts.count ?? 1;
    const rtt: number[] = [];
    let lastReason = '';
    let ok = false;
    this.cancelled = false;
    const icmpId = (pktSeq % 60000) + 1;
    for (let seq = 1; seq <= count; seq++) {
      if (this.cancelled) {
        lastReason = '^C interrupted';
        break;
      }
      const t0 = this.now;
      this.echoWait = { id: icmpId, seq, got: false };
      if (family === 'v4') {
        const s = this.pickSrc4(src, resolved.ip);
        if (!s) {
          lastReason = `No route to ${resolved.ip} on ${src.name} (missing address or gateway)`;
          this.emitEvent({
            from: { device: src.name, iface: '?' },
            srcMac: '',
            dstMac: '',
            proto: 'icmp',
            reason: lastReason,
            drop: true,
          });
          break;
        }
        this.emitL3(src, {
          id: nid('p'),
          family: 'v4',
          src: s.ip,
          dst: resolved.ip,
          proto: 'icmp',
          ttl: opts.ttl ?? 64,
          icmpType: 'echo-request',
          icmpId,
          icmpSeq: seq,
        });
      } else {
        const s = this.pickSrc6(src, resolved.ip);
        if (!s) {
          lastReason = `No route to ${resolved.ip} on ${src.name}`;
          this.emitEvent({
            from: { device: src.name, iface: '?' },
            srcMac: '',
            dstMac: '',
            proto: 'icmp6',
            reason: lastReason,
            drop: true,
          });
          break;
        }
        this.emitL3(src, {
          id: nid('p'),
          family: 'v6',
          src: s.ip,
          dst: resolved.ip,
          proto: 'icmp6',
          ttl: opts.ttl ?? 64,
          icmpType: 'echo-request',
          icmpId,
          icmpSeq: seq,
        });
      }
      this.drain();
      if (this.cancelled) {
        lastReason = '^C interrupted';
        break;
      }
      if (this.echoWait?.got) {
        ok = true;
        rtt.push(Math.max(1, this.now - t0));
        lastReason = `ICMP echo reply from ${resolved.ip}`;
      } else {
        const drops = this.packets.filter((p) => p.drop);
        lastReason = drops.length ? drops[drops.length - 1].reason : `Request timeout for icmp_seq ${seq}`;
      }
    }
    const events = this.packets.slice(start);
    const loss = count - rtt.length;
    const output = [
      `PING ${dst} (${resolved.ip})`,
      ...rtt.map((ms, i) => `64 bytes from ${resolved.ip}: icmp_seq=${i + 1} time=${ms} ms`),
      ...(ok ? [] : [`From lab: ${lastReason}`]),
      `--- ${dst} ping statistics ---`,
      `${count} packets transmitted, ${rtt.length} received, ${Math.round((loss / count) * 100)}% packet loss`,
    ].join('\n');
    return { ok, output, reason: lastReason, events, rttMs: rtt };
  }

  traceroute(srcName: string, dst: string, family: Family): { output: string; events: PacketEvent[]; ok: boolean } {
    const src = this.dev(srcName);
    const resolved = this.resolveName(src, dst, family);
    if (!resolved.ip) return { output: `traceroute: ${resolved.err}`, events: [], ok: false };
    const start = this.packets.length;
    const lines = [`traceroute${family === 'v6' ? '6' : ''} to ${dst} (${resolved.ip}), 30 hops max [simulated]`];
    let ok = false;
    for (let ttl = 1; ttl <= 16; ttl++) {
      this.traceHop = { ttl };
      const r = this.ping(srcName, resolved.ip, { count: 1, family, ttl });
      const hop = this.traceHop.from;
      this.traceHop = null;
      if (r.ok) {
        lines.push(` ${ttl}  ${resolved.ip}  ${r.rttMs[0] ?? 1} ms`);
        ok = true;
        break;
      }
      if (hop) lines.push(` ${ttl}  ${hop}  1 ms`);
      else lines.push(` ${ttl}  * * *  (${r.reason})`);
    }
    return { output: lines.join('\n'), events: this.packets.slice(start), ok };
  }

  getPath(srcName: string, dst: string, proto: string, family: Family): PathResult {
    const start = this.packets.length;
    const src = this.find(srcName);
    if (!src) return { ok: false, hops: [], reason: `unknown device ${srcName}`, events: [] };
    const resolved = this.resolveName(src, dst, family);
    const dest = resolved.ip ?? dst;
    if (proto === 'tcp' || proto === 'ssh') {
      const s = family === 'v6' ? this.pickSrc6(src, dest) : this.pickSrc4(src, dest);
      if (!s) return { ok: false, hops: [], reason: `No route to ${dest} on ${src.name}`, events: [] };
      this.echoWait = { id: 1, seq: 1, got: false };
      this.emitL3(src, {
        id: nid('p'),
        family,
        src: s.ip,
        dst: dest,
        proto: 'tcp',
        ttl: 64,
        dport: 22,
        sport: 40000,
      });
      this.drain();
    } else {
      this.ping(srcName, dest, { count: 1, family });
    }
    const events = this.packets.slice(start);
    const hops = events.filter((e) => !e.drop).map((e) => ({
      device: e.from.device,
      iface: e.from.iface,
      reason: e.reason,
    }));
    const drop = [...events].reverse().find((e) => e.drop);
    const ok = proto === 'tcp' || proto === 'ssh' ? !!this.echoWait?.got && !drop : events.some((e) => e.reason.startsWith('ICMP echo reply'));
    const reason = drop?.reason ?? (ok ? events.filter((e) => e.reason.includes('reply') || e.reason.includes('SSH'))[0]?.reason ?? 'ok' : 'failed');
    return { ok, hops, reason, events, drop };
  }

  runDhclient(dev: Device, ifaceName?: string): string {
    const iface = findIface(dev, ifaceName ?? 'eth0') ?? findIface(dev, 'wlan0');
    if (!iface) return 'dhclient: no interface';
    iface.dhcpClient = true;
    if (!iface.adminUp) return `dhclient: ${iface.name} is down`;
    const disc: L3Packet = {
      id: nid('p'),
      family: 'v4',
      src: '0.0.0.0',
      dst: '255.255.255.255',
      proto: 'dhcp',
      ttl: 64,
      sport: 68,
      dport: 67,
      payload: { msg: 'discover', mac: iface.mac, iface: iface.name },
    };
    this.sendL3On(dev, iface, disc, MAC_BCAST);
    this.drain();
    if (iface.ipv4) return `bound ${iface.ipv4.ip}/${iface.ipv4.prefix} on ${iface.name} gw ${dev.defaultGw4 ?? '-'}`;
    const drop = [...this.packets].reverse().find((p) => p.drop);
    return `dhclient: no DHCPv4 offer (${drop?.reason ?? 'silent'})`;
  }

  exec(deviceId: string, line: string): CliResult {
    const start = this.packets.length;
    const d = this.dev(deviceId);
    const raw = line.replace(/\r/g, '').trim();
    if (!raw) return { output: '', prompt: this.prompt(d), events: [] };
    if (d.cli.sshPeer) {
      if (raw === 'exit' || raw === 'logout') {
        d.cli.sshPeer = undefined;
        return { output: 'Connection closed (simulated).', prompt: this.prompt(d), events: [] };
      }
      return this.exec(d.cli.sshPeer, raw);
    }
    const r = this.dispatchCli(d, raw);
    r.events = this.packets.slice(start);
    r.prompt = this.prompt(d);
    return r;
  }

  prompt(d: Device): string {
    if (d.cli.sshPeer) {
      const p = this.find(d.cli.sshPeer);
      return p ? this.prompt(p) : '# ';
    }
    const h = d.hostname;
    if (d.kind === 'workstation' || d.kind === 'server' || d.kind === 'cloud' || d.kind === 'firewall') {
      return `root@${h}:~# `;
    }
    if (d.cli.level === 'user') return `${h}> `;
    if (d.cli.level === 'priv') return `${h}# `;
    if (d.cli.level === 'if') return `${h}(config-if)# `;
    if (d.cli.level === 'router') return `${h}(config-router)# `;
    if (d.cli.level === 'dhcp') return `${h}(dhcp-config)# `;
    if (d.cli.level === 'acl') return `${h}(config-std-nacl)# `;
    if (d.cli.level === 'wlan') return `${h}(config-wlan)# `;
    return `${h}(config)# `;
  }

  dispatchCli(d: Device, raw: string): CliResult {
    const linux = d.kind === 'workstation' || d.kind === 'server' || d.kind === 'cloud' || d.kind === 'firewall';
    if (d.kind === 'switch' && switchProfileOf(d) === 'unmanaged') {
      return err('% Unmanaged switch: no management interface or CLI. Configure the connected hosts instead.');
    }
    if (raw === 'help' || raw === '?') {
      return out(helpText(d.kind, d.switchProfile) + (linux ? '' : '\n  Also: enable, conf t, end, write, show run'));
    }
    if (linux) return this.linuxCli(d, raw);
    if (d.kind === 'switch') return isMultilayerSwitch(d) ? this.ciscoMultilayerSwitch(d, raw) : this.ciscoSwitch(d, raw);
    if (d.kind === 'router') return this.ciscoRouter(d, raw);
    if (d.kind === 'ap') return this.apCli(d, raw);
    if (d.kind === 'wlc') return this.wlcCli(d, raw);
    return err(`Unknown command: ${raw}`);
  }

  linuxCli(d: Device, raw: string): CliResult {
    const t = tokenize(raw);
    const c = t[0];
    if (c === 'exit') return out('');
    if (c === 'hostname') {
      if (t[1]) d.hostname = t[1];
      return out(d.hostname);
    }
    if (c === 'cat' && t[1] === '/etc/hosts') {
      return out(Object.entries(d.hostsFile).map(([h, ip]) => `${ip} ${h}`).join('\n') || '# empty');
    }
    if (c === 'resolvectl') return out(`DNS: ${d.dnsServers.join(', ') || '(none)'}`);
    if (c === 'ss') {
      return out(d.sshListen ? 'LISTEN 0 128 *:22 sshd (simulated)' : '(no sockets)');
    }
    if (c === 'systemctl' && t[1] === 'start' && (t[2] === 'ssh' || t[2] === 'sshd')) {
      d.sshListen = true;
      d.sshEnabled = true;
      return out('sshd started (simulated login shell, not real crypto)');
    }
    if (c === 'reboot') {
      this.reboot(d);
      return out('reboot (startup-config reapplied)');
    }
    if (c === 'tcpdump') {
      const last = this.packets.slice(-10).map(fmtPkt).join('\n');
      return out(last || '(no packets yet)  [simulated]');
    }
    if (c === 'ip') return this.ipCmd(d, t.slice(1));
    if (c === 'ping' || c === 'ping6') {
      const family: Family = c === 'ping6' || t.includes('-6') ? 'v6' : 'v4';
      let count = 4;
      const ci = t.indexOf('-c');
      if (ci >= 0) count = Number(t[ci + 1] ?? 4);
      const host = t.filter((x, i) => i > 0 && x !== '-c' && t[i - 1] !== '-c' && x !== '-6' && x !== '-I' && t[i - 1] !== '-I').pop();
      if (!host) return err('usage: ping [-c N] HOST');
      const r = this.ping(d.id, host, { count, family });
      return { output: r.output, prompt: '', error: !r.ok, events: r.events };
    }
    if (c === 'traceroute' || c === 'traceroute6') {
      const family: Family = c === 'traceroute6' ? 'v6' : 'v4';
      const host = t[1];
      if (!host) return err('usage: traceroute HOST');
      const r = this.traceroute(d.id, host, family);
      return { output: r.output, prompt: '', error: !r.ok, events: r.events };
    }
    if (c === 'dhclient') return out(this.runDhclient(d, t[1]));
    if (c === 'dig' || c === 'nslookup') {
      const name = t[1];
      if (!name) return err(`${c}: need name`);
      const rec = this.resolveName(d, name);
      return out(rec.ip ? `${name}\t${rec.ip}` : rec.err ?? 'NXDOMAIN');
    }
    if (c === 'iw') {
      if (!d.associatedSsid) return out('Not associated.');
      return out(`SSID: ${d.associatedSsid}\nAP: ${this.find(d.associatedAp ?? '')?.name ?? d.associatedAp}`);
    }
    if (c === 'nmcli') {
      if (t[1] === 'wifi' && t[2] === 'connect') {
        const ssid = t[3];
        const psk = t[4] === 'password' ? t[5] : t[4];
        if (!ssid) return err('nmcli wifi connect SSID password PSK');
        const msg = this.associateWifi(d, ssid, psk);
        if (msg.startsWith('Associated')) {
          const dhcp = this.runDhclient(d, 'wlan0');
          return out(`${msg}\n${dhcp}`);
        }
        return err(msg);
      }
      return err('usage: nmcli wifi connect SSID password PSK');
    }
    if (c === 'ssh') {
      const target = t[1];
      if (!target) return err('ssh user@HOST');
      const host = target.includes('@') ? target.split('@')[1] : target;
      const resolved = this.resolveName(d, host ?? '');
      if (!resolved.ip) return err(resolved.err ?? 'ssh: unresolved');
      const path = this.getPath(d.id, resolved.ip, 'tcp', resolved.family ?? 'v4');
      if (!path.ok) return err(`ssh: connect failed: ${path.reason}`);
      const peer = [...this.devices.values()].find((x) => this.hasIpv4(x, resolved.ip!) || this.hasIpv6(x, resolved.ip!));
      if (peer) d.cli.sshPeer = peer.id;
      return out(`Connected to ${peer?.hostname ?? host} (simulated SSH, not real crypto). Type exit to leave.`);
    }
    if (c === 'show' && t[1] === 'run') return out(this.runningConfig(d));
    if (d.kind === 'firewall') return this.fwCli(d, raw, t);
    return err(`${c}: command not found`);
  }

  ipCmd(d: Device, t: string[]): CliResult {
    if (t[0] === 'addr' && t[1] === 'add') {
      const cidr = t[2];
      const devn = t[t.indexOf('dev') + 1];
      const iface = findIface(d, devn);
      if (!iface || !cidr) return err('usage: ip addr add CIDR dev IF');
      if (cidr.includes(':')) {
        const p = parseCidrV6(cidr);
        if (!p) return err('bad IPv6 CIDR');
        iface.ipv6.push({ ip: formatIPv6(p.ip), prefix: p.prefix });
      } else {
        const p = parseCidrV4(cidr);
        if (!p) return err('bad IPv4 CIDR');
        iface.ipv4 = { ip: formatIPv4(p.ip), prefix: p.prefix };
        this.detectConflict(d, iface);
      }
      this.rebuildConnected(d);
      return out('');
    }
    if (t[0] === 'addr' && (t[1] === 'del' || t[1] === 'delete' || t[1] === 'flush')) {
      const devn = t[t.indexOf('dev') + 1];
      const iface = findIface(d, devn);
      if (!iface) return err('usage: ip addr del CIDR dev IF');
      if (t[1] === 'flush') {
        iface.ipv4 = undefined;
        iface.ipv6 = iface.ipv6.filter((v) => v.ip.toLowerCase().startsWith('fe80'));
      } else {
        const cidr = t[2];
        if (!cidr || cidr === 'dev') return err('usage: ip addr del CIDR dev IF');
        if (cidr.includes(':')) {
          const p = parseCidrV6(cidr);
          if (!p) return err('bad IPv6 CIDR');
          const ip = formatIPv6(p.ip);
          const before = iface.ipv6.length;
          iface.ipv6 = iface.ipv6.filter((v) => !(v.ip === ip && v.prefix === p.prefix));
          if (before === iface.ipv6.length) return err('RTNETLINK answers: Cannot assign requested address');
        } else {
          const p = parseCidrV4(cidr);
          if (!p) return err('bad IPv4 CIDR');
          if (!iface.ipv4 || iface.ipv4.ip !== formatIPv4(p.ip)) return err('RTNETLINK answers: Cannot assign requested address');
          iface.ipv4 = undefined;
        }
      }
      d.arp = d.arp.filter((e) => e.iface !== iface.name);
      this.rebuildConnected(d);
      this.pruneUnreachableRoutes(d);
      return out('');
    }
    if (t[0] === 'addr' || (t[0] === 'addr' && t[1] === 'show') || t.length === 0 || t[0] === 'a') {
      return out(d.ifaces.map((i) => {
        const v4 = i.ipv4 ? `    inet ${i.ipv4.ip}/${i.ipv4.prefix}` : '';
        const v6 = i.ipv6.map((v) => `    inet6 ${v.ip}/${v.prefix}`).join('\n');
        return `${i.name}: ${i.adminUp ? 'UP' : 'DOWN'} mac ${i.mac}\n${v4}\n${v6}`;
      }).join('\n'));
    }
    if (t[0] === 'link' && t[1] === 'set') {
      const iface = findIface(d, t[2]);
      if (!iface) return err('unknown iface');
      if (t[3] === 'up') iface.adminUp = true;
      else if (t[3] === 'down') iface.adminUp = false;
      else return err('ip link set IF up|down');
      this.rebuildConnected(d);
      return out('');
    }
    if (t[0] === 'link') {
      return out(d.ifaces.map((i) => `${i.name}: ${i.adminUp ? 'UP' : 'DOWN'} ${this.operUp(d, i) ? 'LOWER_UP' : 'NO-CARRIER'} mac ${i.mac}`).join('\n'));
    }
    if (t[0] === 'route' && (t[1] === 'add' || t[1] === 'del' || t[1] === 'delete' || t[1] === 'replace' || t[1] === 'change')) {
      const mode = t[1];
      const target = t[2];
      const via = t.includes('via') ? t[t.indexOf('via') + 1] : undefined;
      if (!target || target === 'via') return err('usage: ip route add|del|replace default via GW | ip route add|del CIDR via GW');
      const v6 = target.includes(':') || (via?.includes(':') ?? false) || t.includes('-6');
      if (mode === 'add') return this.addRoute(d, target, via, v6);
      if (mode === 'del' || mode === 'delete') {
        if (!this.removeRoute(d, target, via, v6)) return err('RTNETLINK answers: No such process');
        this.logActivity(`${d.name} route del ${target}${via ? ' via ' + via : ''}`);
        return out('');
      }
      // replace/change: the existing route for this destination goes, whatever its old next hop was.
      if (!via) return err(`usage: ip route ${mode} ${target} via GW`);
      this.removeRoute(d, target, undefined, v6);
      return this.addRoute(d, target, via, v6);
    }
    if (t[0] === 'route' || t[0] === '-6') {
      this.rebuildConnected(d);
      if (t[0] === '-6' || t.includes('-6')) {
        return out(d.routesV6.map((r) => `${r.dest}/${r.prefix} ${r.nexthop ? 'via ' + r.nexthop : 'dev ' + (r.iface ?? '')} proto ${r.proto}`).join('\n'));
      }
      return out(d.routesV4.map((r) => `${r.dest}/${r.prefix} ${r.nexthop ? 'via ' + r.nexthop : 'dev ' + (r.iface ?? '')} proto ${r.proto}`).join('\n'));
    }
    return err('ip: unknown subcommand');
  }

  /** `ip route add`: Linux refuses a second default route ("File exists"); use replace to change it. */
  private addRoute(d: Device, target: string, via: string | undefined, v6: boolean): CliResult {
    if (target === 'default') {
      if (!via) return err('usage: ip route add default via GW');
      if (v6) {
        if (d.routesV6.some((r) => r.prefix === 0 && r.proto === 'static')) return err('RTNETLINK answers: File exists (use: ip route replace default via GW)');
        d.defaultGw6 = via;
        d.routesV6.push({ dest: '::', prefix: 0, nexthop: via, proto: 'static', ad: 1 });
        return out('');
      }
      if (d.routesV4.some((r) => r.prefix === 0 && r.proto === 'static')) return err('RTNETLINK answers: File exists (use: ip route replace default via GW)');
      d.defaultGw4 = via;
      d.routesV4.push({ dest: '0.0.0.0', prefix: 0, nexthop: via, proto: 'static', ad: 1 });
      return out('');
    }
    const p4 = parseCidrV4(target);
    if (p4) {
      const dest = formatIPv4(networkAddr(p4.ip, p4.prefix));
      if (d.routesV4.some((r) => r.proto === 'static' && r.dest === dest && r.prefix === p4.prefix)) return err('RTNETLINK answers: File exists');
      d.routesV4.push({ dest, prefix: p4.prefix, nexthop: via, proto: 'static', ad: 1 });
      return out('');
    }
    const p6 = parseCidrV6(target);
    if (p6) {
      d.routesV6.push({ dest: formatIPv6(p6.ip), prefix: p6.prefix, nexthop: via, proto: 'static', ad: 1 });
      return out('');
    }
    return err('usage: ip route add default via GW | ip route add CIDR via GW');
  }

  private removeRoute(d: Device, target: string, via: string | undefined, v6: boolean): boolean {
    if (target === 'default') {
      if (v6) {
        const before = d.routesV6.length;
        d.routesV6 = d.routesV6.filter((r) => !(r.prefix === 0 && r.proto !== 'connected' && (!via || r.nexthop === via)));
        if (!via || d.defaultGw6 === via) d.defaultGw6 = undefined;
        return d.routesV6.length !== before;
      }
      const before = d.routesV4.length;
      d.routesV4 = d.routesV4.filter((r) => !(r.prefix === 0 && r.proto === 'static' && (!via || r.nexthop === via)));
      if (!via || d.defaultGw4 === via) d.defaultGw4 = undefined;
      return d.routesV4.length !== before;
    }
    const p4 = parseCidrV4(target);
    if (p4) {
      const dest = formatIPv4(networkAddr(p4.ip, p4.prefix));
      const before = d.routesV4.length;
      d.routesV4 = d.routesV4.filter((r) => !(r.proto === 'static' && r.dest === dest && r.prefix === p4.prefix && (!via || r.nexthop === via)));
      return d.routesV4.length !== before;
    }
    const p6 = parseCidrV6(target);
    if (p6) {
      const dest = formatIPv6(p6.ip);
      const before = d.routesV6.length;
      d.routesV6 = d.routesV6.filter((r) => !(r.proto === 'static' && r.dest === dest && r.prefix === p6.prefix && (!via || r.nexthop === via)));
      return d.routesV6.length !== before;
    }
    return false;
  }

  /** After an address is removed, static routes whose next hop is no longer on a connected subnet go too (kernel behaviour). */
  private pruneUnreachableRoutes(d: Device): void {
    const keep = d.routesV4.filter((r) => r.proto !== 'static' || !r.nexthop || !!this.ifaceForGw4(d, r.nexthop));
    if (keep.length !== d.routesV4.length) {
      if (!keep.some((r) => r.prefix === 0 && r.proto === 'static')) d.defaultGw4 = undefined;
      d.routesV4 = keep;
    }
  }

  detectConflict(d: Device, iface: Iface): void {
    if (!iface.ipv4) return;
    for (const o of this.devices.values()) {
      for (const i of o.ifaces) {
        if (i === iface) continue;
        if (i.ipv4?.ip === iface.ipv4.ip) {
          this.warnings.push(`IPv4 conflict: ${iface.ipv4.ip} on ${d.name} ${iface.name} and ${o.name} ${i.name}`);
        }
      }
    }
  }

  ciscoSwitch(d: Device, raw: string): CliResult {
    const t = tokenize(raw);
    const c = t.join(' ');
    if (t[0] === 'enable' || t[0] === 'en') {
      d.cli.level = 'priv';
      return out('');
    }
    if (t[0] === 'disable') {
      d.cli.level = 'user';
      return out('');
    }
    if (t[0] === 'end') {
      d.cli.level = 'priv';
      d.cli.iface = undefined;
      return out('');
    }
    if (t[0] === 'exit') {
      if (d.cli.level === 'if' || d.cli.level === 'config') {
        d.cli.level = d.cli.level === 'if' ? 'config' : 'priv';
        d.cli.iface = undefined;
        return out('');
      }
      return out('');
    }
    if (c.startsWith('conf') || c === 'configure terminal' || c === 'config t') {
      if (d.cli.level === 'user') return err('% Privileged commands must be entered in privileged mode.');
      d.cli.level = 'config';
      return out('');
    }
    if (t[0] === 'hostname' && t[1]) {
      d.hostname = t[1];
      d.name = t[1];
      return out('');
    }
    if (t[0] === 'vlan' && t[1]) {
      const n = Number(t[1]);
      if (!d.vlans.includes(n)) d.vlans.push(n);
      return out('');
    }
    if (t[0] === 'interface' || t[0] === 'int') {
      const name = t[1];
      if (!name) return err('% Incomplete command');
      if (/^vlan/i.test(name)) ensureSvi(d, Number(name.replace(/vlan/i, '')));
      const iface = findIface(d, name);
      if (!iface) return err(`% Invalid interface ${name}`);
      d.cli.level = 'if';
      d.cli.iface = iface.name;
      return out('');
    }
    if (d.cli.level === 'if' && d.cli.iface) {
      const iface = findIface(d, d.cli.iface)!;
      if (c === 'no shutdown' || c === 'no shut') {
        iface.adminUp = true;
        return out('');
      }
      if (t[0] === 'shutdown' || t[0] === 'shut') {
        iface.adminUp = false;
        return out('');
      }
      if (c === 'no ip address' || (t[0] === 'no' && t[1] === 'ip' && t[2] === 'address')) {
        iface.ipv4 = undefined;
        d.arp = d.arp.filter((e) => e.iface !== iface.name);
        this.rebuildConnected(d);
        return out('');
      }
      if (t[0] === 'no' && t[1] === 'ipv6' && t[2] === 'address') {
        const p = t[3] ? parseCidrV6(t[3]) : null;
        iface.ipv6 = iface.ipv6.filter((v) => v.ip.toLowerCase().startsWith('fe80') || (p ? !(v.ip === formatIPv6(p.ip) && v.prefix === p.prefix) : false));
        this.rebuildConnected(d);
        return out('');
      }
      if (c === 'switchport mode access') {
        iface.mode = 'access';
        return out('');
      }
      if (c === 'switchport mode trunk') {
        iface.mode = 'trunk';
        return out('');
      }
      if (c === 'no switchport') {
        if (!isMultilayerSwitch(d)) return err('% Routed ports require a multilayer switch');
        iface.mode = 'routed';
        iface.accessVlan = 1;
        return out('');
      }
      if (c === 'switchport') {
        iface.mode = 'access';
        iface.accessVlan = 1;
        return out('');
      }
      if (t[0] === 'switchport' && t[1] === 'access' && t[2] === 'vlan') {
        iface.mode = 'access';
        iface.accessVlan = Number(t[3]);
        if (!d.vlans.includes(iface.accessVlan)) d.vlans.push(iface.accessVlan);
        return out('');
      }
      if (t[0] === 'switchport' && t[1] === 'trunk' && t[2] === 'allowed' && t[3] === 'vlan') {
        iface.mode = 'trunk';
        if (t[4] === 'all') iface.allowedVlans = 'all';
        else iface.allowedVlans = t[4].split(',').map(Number);
        return out('');
      }
      if (t[0] === 'switchport' && t[1] === 'trunk' && t[2] === 'native' && t[3] === 'vlan') {
        const native = Number(t[4]);
        if (!Number.isInteger(native) || native < 1 || native > 4094) return err('% Invalid native VLAN');
        iface.mode = 'trunk';
        iface.nativeVlan = native;
        if (!d.vlans.includes(native)) d.vlans.push(native);
        return out('');
      }
      if (t[0] === 'ip' && t[1] === 'helper-address') {
        if (!isMultilayerSwitch(d)) return err('% DHCP relay requires a multilayer switch');
        if (parseIPv4(t[2]) === null) return err('% Invalid helper address');
        iface.helperAddress = t[2];
        return out('');
      }
      if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'helper-address') {
        iface.helperAddress = undefined;
        return out('');
      }
      if (t[0] === 'ip' && t[1] === 'address') {
        const ip = t[2];
        const prefix = parseMaskOrPrefix(t[3] ?? '24');
        if (!ip || prefix === null) return err('% Invalid address');
        iface.ipv4 = { ip, prefix };
        return out('');
      }
      if (t[0] === 'ipv6' && t[1] === 'address') {
        const p = parseCidrV6(t[2]);
        if (!p) return err('% Invalid IPv6');
        iface.ipv6.push({ ip: formatIPv6(p.ip), prefix: p.prefix });
        return out('');
      }
    }
    if (t[0] === 'ip' && t[1] === 'default-gateway') {
      d.defaultGw4 = t[2];
      d.routesV4 = d.routesV4.filter((r) => !(r.prefix === 0 && r.proto === 'static'));
      this.rebuildConnected(d);
      return out('');
    }
    if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'default-gateway') {
      d.defaultGw4 = undefined;
      d.routesV4 = d.routesV4.filter((r) => !(r.prefix === 0 && r.proto === 'static'));
      return out('');
    }
    if (t[0] === 'write' || c === 'copy run start' || c === 'write memory') {
      d.startupLines = this.runningConfig(d).split('\n');
      return out('Building configuration...\n[OK]');
    }
    if (t[0] === 'show' || t[0] === 'sh') return this.showCmd(d, t.slice(1));
    if (t[0] === 'ping') {
      const r = this.ping(d.id, t[1], { count: 5, family: 'v4' });
      return { output: r.output, prompt: '', error: !r.ok, events: r.events };
    }
    return err(`% Unknown command: ${raw}`);
  }

  ciscoMultilayerSwitch(d: Device, raw: string): CliResult {
    const t = tokenize(raw);
    const c = t.join(' ');
    if (c === 'ip routing') {
      d.ipRouting = true;
      d.forwarding = true;
      this.rebuildConnected(d);
      return out('');
    }
    if (c === 'no ip routing') {
      d.ipRouting = false;
      d.forwarding = false;
      this.rebuildConnected(d);
      return out('');
    }
    const routerCommand =
      d.cli.level === 'dhcp' ||
      (t[0] === 'ip' && t[1] === 'route') ||
      (t[0] === 'no' && t[1] === 'ip' && t[2] === 'route') ||
      (t[0] === 'ipv6' && t[1] === 'route') ||
      (t[0] === 'ip' && t[1] === 'dhcp') ||
      (t[0] === 'no' && t[1] === 'ip' && t[2] === 'dhcp');
    if (routerCommand) return this.ciscoRouter(d, raw);
    return this.ciscoSwitch(d, raw);
  }

  ciscoRouter(d: Device, raw: string): CliResult {
    const t = tokenize(raw);
    const c = t.join(' ');
    if ((t[0] === 'interface' || t[0] === 'int') && t[1]?.includes('.')) {
      const [parent, vlan] = t[1].split('.');
      const sub = ensureSubif(d, parent, Number(vlan));
      d.cli.level = 'if';
      d.cli.iface = sub.name;
      return out('');
    }
    if (t[0] === 'router' && t[1] === 'ospf') {
      if (t[2] && t[2] !== '1') return err('% Only process 1 / area 0 is supported in NetBench');
      d.ospf.enabled = true;
      d.ospf.process = 1;
      d.cli.level = 'router';
      return out('');
    }
    if (d.cli.level === 'router') {
      if (t[0] === 'router-id') {
        d.ospf.routerId = t[1];
        return out('');
      }
      if (t[0] === 'network') {
        const areaTok = t.includes('area') ? t[t.indexOf('area') + 1] : t[4];
        if (areaTok !== '0') return err('% Only area 0 is supported (no NSSA, no virtual-links)');
        d.ospf.networks.push({ network: t[1], wildcard: t[2], area: '0' });
        d.ospf.enabled = true;
        this.convergeOspf();
        return out('');
      }
      if (t[0] === 'exit' || t[0] === 'end') {
        d.cli.level = t[0] === 'end' ? 'priv' : 'config';
        return out('');
      }
    }
    if (t[0] === 'ip' && t[1] === 'dhcp' && t[2] === 'excluded-address') {
      if (parseIPv4(t[3]) === null) return err('% Invalid excluded address');
      const end = t[4] ?? t[3];
      if (parseIPv4(end) === null) return err('% Invalid excluded address range');
      d.dhcpExcluded.push({ start: t[3], end });
      return out('');
    }
    if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'dhcp' && t[3] === 'excluded-address') {
      const start = t[4];
      const end = t[5] ?? start;
      d.dhcpExcluded = d.dhcpExcluded.filter((range) => range.start !== start || range.end !== end);
      return out('');
    }
    if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'dhcp' && t[3] === 'pool') {
      if (!t[4]) return err('% Incomplete command');
      d.dhcpPools = d.dhcpPools.filter((p) => p.name !== t[4]);
      if (d.cli.dhcpPool === t[4]) {
        d.cli.level = 'config';
        d.cli.dhcpPool = undefined;
      }
      return out('');
    }
    if (t[0] === 'ip' && t[1] === 'dhcp' && t[2] === 'pool') {
      if (!t[3]) return err('% Incomplete command');
      // Re-entering an existing pool edits it (IOS behaviour) instead of shadowing it with an empty duplicate.
      if (!d.dhcpPools.some((p) => p.name === t[3])) d.dhcpPools.push({ name: t[3] });
      d.cli.level = 'dhcp';
      d.cli.dhcpPool = t[3];
      return out('');
    }
    if (d.cli.level === 'dhcp' && d.cli.dhcpPool) {
      const pool = d.dhcpPools.find((p) => p.name === d.cli.dhcpPool);
      if (pool && t[0] === 'network') {
        const prefix = parseMaskOrPrefix(t[2] ?? '24') ?? 24;
        pool.network = t[1];
        pool.prefix = prefix;
        return out('');
      }
      if (pool && t[0] === 'default-router') {
        pool.gateway = t[1];
        return out('');
      }
      if (pool && t[0] === 'dns-server') {
        pool.dns = t[1];
        return out('');
      }
      if (t[0] === 'exit' || t[0] === 'end') {
        d.cli.level = t[0] === 'end' ? 'priv' : 'config';
        return out('');
      }
    }
    if (t[0] === 'no' && t[1] === 'ip' && t[2] === 'route') {
      const dest = t[3];
      const maskTok = t[4];
      const nh = t[5];
      if (!dest) return err('% Incomplete command');
      const prefix = dest === '0.0.0.0' && (maskTok === '0.0.0.0' || !maskTok) ? 0 : parseMaskOrPrefix(maskTok ?? '');
      const ipN = parseIPv4(dest);
      if (prefix === null || ipN === null) return err('% Invalid route');
      const network = prefix === 0 ? '0.0.0.0' : formatIPv4(networkAddr(ipN, prefix));
      const before = d.routesV4.length;
      d.routesV4 = d.routesV4.filter((r) => !(r.proto === 'static' && r.dest === network && r.prefix === prefix && (!nh || r.nexthop === nh)));
      if (before === d.routesV4.length) return err('% No matching static route');
      if (prefix === 0 && (!nh || d.defaultGw4 === nh)) d.defaultGw4 = undefined;
      this.logActivity(`${d.name} removed static route ${network}/${prefix}${nh ? ' via ' + nh : ''}`);
      return out('');
    }
    if (t[0] === 'ip' && t[1] === 'route') {
      const dest = t[2];
      if (dest === '0.0.0.0') {
        const nh = t[4] === '0.0.0.0' ? t[5] : t[4];
        if (!nh) return err('% Incomplete command');
        d.routesV4.push({ dest: '0.0.0.0', prefix: 0, nexthop: nh, proto: 'static', ad: 1 });
        return out('');
      }
      const mask = parseMaskOrPrefix(t[3] ?? '');
      const nh = t[4];
      if (mask === null || !dest || !nh) return err('% Invalid route');
      d.routesV4.push({ dest: formatIPv4(networkAddr(parseIPv4(dest)!, mask)), prefix: mask, nexthop: nh, proto: 'static', ad: 1 });
      return out('');
    }
    if (t[0] === 'ip' && t[1] === 'nat' && t[2] === 'inside' && t[3] === 'source') {
      d.natAcl = t[5];
      d.natOverloadIface = t[7] ?? t[6];
      return out('');
    }
    if (t[0] === 'ip' && t[1] === 'access-list') {
      const name = t[3] ?? t[2];
      d.acls[name] = d.acls[name] ?? [];
      d.cli.level = 'acl';
      d.cli.aclName = name;
      return out('');
    }
    if (t[0] === 'ipv6' && t[1] === 'access-list') {
      const name = t[2];
      d.acls[name] = d.acls[name] ?? [];
      d.cli.level = 'acl';
      d.cli.aclName = name;
      return out('');
    }
    if (t[0] === 'ipv6' && t[1] === 'route') {
      const p = parseCidrV6(t[2]);
      if (!p) return err('% Invalid');
      d.routesV6.push({ dest: formatIPv6(p.ip), prefix: p.prefix, nexthop: t[3], proto: 'static', ad: 1 });
      return out('');
    }
    const base = this.ciscoSwitch(d, raw);
    if (!base.error || !String(base.output).startsWith('% Unknown')) return base;
    if (d.cli.level === 'if' && d.cli.iface) {
      const iface = findIface(d, d.cli.iface)!;
      if (t[0] === 'encapsulation' && /^dot1q$/i.test(t[1] ?? '')) {
        iface.encapVlan = Number(t[2]);
        iface.vlanId = iface.encapVlan;
        return out('');
      }
      if (c === 'ip nat inside') {
        iface.nat = 'inside';
        return out('');
      }
      if (c === 'ip nat outside') {
        iface.nat = 'outside';
        return out('');
      }
      if (c === 'ipv6 nd suppress-ra') {
        iface.raSuppress = true;
        return out('');
      }
      if (c === 'no ipv6 nd suppress-ra') {
        iface.raSuppress = false;
        return out('');
      }
      if (t[0] === 'ipv6' && t[1] === 'nd' && t[2] === 'prefix') {
        const p = parseCidrV6(t[3]);
        if (!p) return err('% Invalid prefix');
        iface.raPrefix = { cidr: t[3], prefix: p.prefix };
        iface.raSuppress = false;
        return out('');
      }
      if (t[0] === 'ip' && t[1] === 'address') {
        const ip = t[2];
        const prefix = parseMaskOrPrefix(t[3] ?? '');
        if (!ip || prefix === null) return err('% Invalid address');
        iface.ipv4 = { ip, prefix };
        this.rebuildConnected(d);
        return out('');
      }
    }
    if (d.cli.level === 'acl' && d.cli.aclName) {
      if (t[0] === 'permit' || t[0] === 'deny') {
        const proto = t[1] === 'tcp' || t[1] === 'udp' || t[1] === 'icmp' ? t[1] : 'ip';
        const srcIdx = proto === 'ip' ? 1 : 2;
        let src = t[srcIdx] ?? 'any';
        const maybeWild = t[srcIdx + 1];
        if (src !== 'any' && maybeWild && parseIPv4(maybeWild) !== null && !maybeWild.includes(':')) {
          const pref = wildcardToPrefix(parseIPv4(maybeWild)!);
          if (pref >= 0) src = `${networkAddr(parseIPv4(src)!, pref) >>> 0 === parseIPv4(src)! ? src : src}/${pref}`;
          src = `${formatIPv4(networkAddr(parseIPv4(t[srcIdx])!, pref))}/${pref}`;
        }
        d.acls[d.cli.aclName].push({
          action: t[0],
          proto,
          src,
          dst: 'any',
          dport: t.includes('eq') ? Number(t[t.indexOf('eq') + 1]) : undefined,
        });
        return out('');
      }
      if (t[0] === 'exit') {
        d.cli.level = 'config';
        return out('');
      }
    }
    return err(`% Unknown command: ${raw}`);
  }

  apCli(d: Device, raw: string): CliResult {
    const t = tokenize(raw);
    const c = t.join(' ');
    if (t[0] === 'enable' || t[0] === 'conf' || t[0] === 'configure' || t[0] === 'end' || t[0] === 'exit' || t[0] === 'write') {
      return this.ciscoSwitch(d, raw);
    }
    if (t[0] === 'interface' || t[0] === 'int') return this.ciscoSwitch(d, raw);
    // Inside "interface X", shut/no shut act on that port only (same as the switch CLI).
    if (d.cli.level === 'if' && d.cli.iface && (c === 'no shutdown' || c === 'no shut' || t[0] === 'shutdown' || t[0] === 'shut')) {
      return this.ciscoSwitch(d, raw);
    }
    if (t[0] === 'ssid' && t[1]) {
      let w = d.wifi.find((x) => x.ssid === t[1]);
      if (!w) {
        w = { ssid: t[1], vlan: 1, channel: 6 };
        d.wifi.push(w);
      }
      d.cli.wlanName = t[1];
      d.cli.level = 'wlan';
      return out('');
    }
    if (t[0] === 'vlan' && d.cli.wlanName) {
      const w = d.wifi.find((x) => x.ssid === d.cli.wlanName)!;
      w.vlan = Number(t[1]);
      const up = findIface(d, 'Gi0/1');
      if (up && up.mode === 'access') up.accessVlan = w.vlan;
      return out('');
    }
    if (t[0] === 'wpa2-psk' && d.cli.wlanName) {
      const w = d.wifi.find((x) => x.ssid === d.cli.wlanName)!;
      w.psk = t[1];
      return out('');
    }
    if (t[0] === 'channel') {
      const w = d.wifi.find((x) => x.ssid === d.cli.wlanName) ?? d.wifi[0];
      if (w) w.channel = Number(t[1]);
      return out('');
    }
    if (t[0] === 'capwap' && t[1] === 'controller') {
      d.capwapController = t[2];
      this.syncWlc(d);
      return out(d.joinedWlc ? `Joined WLC ${d.joinedWlc} (capwap-lite, local-breakout datapath)` : `Controller ${t[2]} not reachable yet`);
    }
    // Outside interface mode "no shutdown" brings radio and uplink up together (AP quick-start).
    if (c === 'no shutdown' || c === 'no shut') {
      for (const i of d.ifaces) i.adminUp = true;
      return out('');
    }
    if (t[0] === 'shutdown' || t[0] === 'shut') return err('% Enter interface mode first: interface wlan0 (or Gi0/1)');
    if (t[0] === 'show' || t[0] === 'sh') {
      if (t[1] === 'ssid') return out(d.wifi.map((w) => `${w.ssid} vlan ${w.vlan} ch ${w.channel} ${w.psk ? 'wpa2-psk' : 'open'}`).join('\n') || '(no ssid)');
      if (t[1] === 'interface' || t[1] === 'int') return this.showCmd(d, ['int']);
      if (t[1] === 'run') return out(this.runningConfig(d));
    }
    return err(`% Unknown command: ${raw}`);
  }

  wlcCli(d: Device, raw: string): CliResult {
    const t = tokenize(raw);
    const c = t.join(' ');
    if (t[0] === 'enable' || t[0] === 'configure' || t[0] === 'conf' || t[0] === 'end' || t[0] === 'exit' || t[0] === 'write') return this.ciscoSwitch(d, raw);
    if (t[0] === 'interface' || t[0] === 'int') return this.ciscoSwitch(d, raw);
    if (d.cli.level === 'if' && d.cli.iface && (c === 'no shutdown' || c === 'no shut' || t[0] === 'shutdown' || t[0] === 'shut')) {
      return this.ciscoSwitch(d, raw);
    }
    if (t[0] === 'wlan' && t[1] === 'create') {
      const ssid = t[2];
      const vlan = t[3] === 'vlan' ? Number(t[4]) : Number(t[3]);
      d.wlans.push({ ssid, vlan: vlan || 1 });
      d.cli.wlanName = ssid;
      for (const ap of this.devices.values()) if (ap.kind === 'ap') this.syncWlc(ap);
      return out(`WLAN ${ssid} vlan ${vlan || 1}`);
    }
    if (t[0] === 'wpa2' && t[1] === 'psk') {
      const w = d.wlans.find((x) => x.ssid === d.cli.wlanName) ?? d.wlans[d.wlans.length - 1];
      if (w) w.psk = t[2];
      for (const ap of this.devices.values()) if (ap.kind === 'ap') this.syncWlc(ap);
      return out('');
    }
    if (t[0] === 'show' && t[1] === 'ap') {
      const aps = [...this.devices.values()].filter((x) => x.kind === 'ap' && x.joinedWlc === d.name);
      return out(aps.map((a) => `${a.name} joined (local-breakout)`).join('\n') || '(no APs)');
    }
    if (t[0] === 'show' && t[1] === 'wlan') {
      return out(d.wlans.map((w) => `${w.ssid} vlan ${w.vlan} ${w.psk ? 'wpa2-psk' : 'open'}`).join('\n') || '(none)');
    }
    if (t[0] === 'show' && t[1] === 'run') return out(this.runningConfig(d));
    if (t[0] === 'ip') return this.ciscoRouter(d, raw);
    return err(`% Unknown command: ${raw}`);
  }

  fwCli(d: Device, raw: string, t: string[]): CliResult {
    if (t[0] === 'zone' && t[1] && t[2]) {
      const iface = findIface(d, t[2]);
      if (!iface) return err('unknown iface');
      iface.zone = t[1];
      return out('');
    }
    if (t[0] === 'masquerade') {
      d.masqueradeZones.push(t[1] ?? 'wan');
      const wan = d.ifaces.find((i) => i.zone === (t[1] ?? 'wan'));
      if (wan) wan.nat = 'outside';
      for (const i of d.ifaces) if (i.zone === 'lan' || i.zone === 'wifi') i.nat = 'inside';
      return out('masquerade enabled (IPv4 SNAT)');
    }
    if (t[0] === 'policy') {
      const srcZ = t[1];
      const dstZ = t[2];
      const action = t[3] === 'deny' || t[3] === 'drop' ? 'deny' : 'allow';
      const proto = t[4] === 'tcp' || t[4] === 'udp' || t[4] === 'icmp' || t[4] === 'icmp6' ? t[4] : 'any';
      const dport = t[4] === 'tcp' || t[4] === 'udp' ? Number(t[5]) : undefined;
      if (d.fwRules.length === 1 && d.fwRules[0].proto === 'any' && d.fwRules[0].action === 'allow') d.fwRules = [];
      d.fwRules.push({ action, proto, srcZone: srcZ, dstZone: dstZ, dport, family: 'any' });
      d.fwPolicy = 'drop';
      return out('');
    }
    if (t[0] === 'nft') {
      const join = raw;
      const action: 'allow' | 'deny' = /drop|deny/.test(join) ? 'deny' : 'allow';
      const dport = /dport\s+(\d+)/.exec(join);
      const proto = /tcp/.test(join) ? 'tcp' : /udp/.test(join) ? 'udp' : /icmp6/.test(join) ? 'icmp6' : /icmp/.test(join) ? 'icmp' : 'any';
      const saddr = /saddr\s+(\S+)/.exec(join);
      const daddr = /daddr\s+(\S+)/.exec(join);
      if (d.fwRules.length === 1 && d.fwRules[0].action === 'allow' && d.fwRules[0].proto === 'any') d.fwRules = [];
      d.fwRules.unshift({
        action,
        proto,
        src: saddr?.[1],
        dst: daddr?.[1],
        dport: dport ? Number(dport[1]) : undefined,
        family: /ip6/.test(join) ? 'v6' : /ip /.test(join) ? 'v4' : 'any',
      });
      return out('');
    }
    if (t[0] === 'show' && (t[1] === 'rules' || t[1] === 'run')) return out(this.runningConfig(d));
    return err(`${t[0]}: command not found`);
  }

  showCmd(d: Device, t: string[]): CliResult {
    const s = t.join(' ');
    if (t[0] === 'run' || s.startsWith('running')) return out(this.runningConfig(d));
    if (t[0] === 'vlan') {
      return out(['VLAN Name           Ports', ...d.vlans.map((v) => {
        const ports = d.ifaces.filter((i) => i.mode === 'access' && i.accessVlan === v).map((i) => i.name);
        return `${v}    VLAN${v}          ${ports.join(', ')}`;
      })].join('\n'));
    }
    if (t[0] === 'mac') {
      return out(
        ['Vlan    Mac Address       Ports', ...d.macTable.map((m) => `${m.vlan}    ${m.mac}    ${m.iface}`)].join('\n'),
      );
    }
    if (t[0] === 'int' || t[0] === 'interfaces' || t[0] === 'ip' && t[1] === 'int') {
      return out(d.ifaces.map((i) => `${i.name} is ${i.adminUp ? 'up' : 'administratively down'}, line protocol is ${this.operUp(d, i) ? 'up' : 'down'}\n  MAC ${i.mac}  ${i.ipv4 ? 'inet ' + i.ipv4.ip + '/' + i.ipv4.prefix : ''} ${i.mode} vlan ${i.accessVlan}`).join('\n'));
    }
    if (t[0] === 'trunk' || (t[0] === 'int' && t[1] === 'trunk')) {
      return out(d.ifaces.filter((i) => i.mode === 'trunk').map((i) => `${i.name} trunk native ${i.nativeVlan} allowed ${i.allowedVlans === 'all' ? 'all' : i.allowedVlans.join(',')}`).join('\n') || '(no trunks)');
    }
    if (t[0] === 'ip' && t[1] === 'route') {
      this.rebuildConnected(d);
      return out(d.routesV4.map((r) => `${r.proto === 'ospf' ? 'O' : r.proto === 'connected' ? 'C' : 'S'} ${r.dest}/${r.prefix} ${r.nexthop ? 'via ' + r.nexthop : 'is directly connected'} ${r.iface ?? ''}`).join('\n'));
    }
    if (t[0] === 'ip' && t[1] === 'dhcp' && t[2] === 'binding') {
      return out(
        ['IP address       Client MAC         Interface', ...d.dhcpBindings.map((b) => `${b.ip.padEnd(16)} ${b.mac.padEnd(18)} ${b.iface}`)].join('\n'),
      );
    }
    if (t[0] === 'ipv6' && t[1] === 'route') {
      this.rebuildConnected(d);
      return out(d.routesV6.map((r) => `${r.proto} ${r.dest}/${r.prefix} ${r.nexthop ?? r.iface ?? ''}`).join('\n'));
    }
    if (t[0] === 'ip' && t[1] === 'ospf' && t[2] === 'neighbor') {
      return out(
        ['Neighbor ID     State    Address      Interface', ...d.ospf.neighbors.map((n) => `${n.routerId}  ${n.state}/P2P  ${n.peerIp}  ${n.iface}`)].join('\n'),
      );
    }
    if (t[0] === 'ip' && t[1] === 'ospf' && t[2] === 'database') {
      return out(d.ospf.lsdb.map((l) => `Router LSA ${l.id} adv ${l.adv} prefixes ${l.prefixes.map((p) => p.dest + '/' + p.prefix).join(', ')}`).join('\n') || '(empty LSDB)');
    }
    return err('% Unknown show command');
  }

  runningConfig(d: Device): string {
    if (d.kind === 'switch' && switchProfileOf(d) === 'unmanaged') {
      return `! ${d.hostname}: unmanaged switch\n! No configurable operating system or management plane`;
    }
    const L: string[] = [`hostname ${d.hostname}`];
    if (isMultilayerSwitch(d)) L.push(d.ipRouting ? 'ip routing' : 'no ip routing');
    if (d.kind === 'switch') {
      for (const v of d.vlans.filter((x) => x !== 1)) L.push(`vlan ${v}`);
    }
    for (const i of d.ifaces) {
      L.push(`interface ${i.name}`);
      if (i.mode === 'access' && (d.kind === 'switch' || i.isRadio)) {
        L.push(` switchport mode access`);
        L.push(` switchport access vlan ${i.accessVlan}`);
      }
      if (i.mode === 'routed' && d.kind === 'switch' && i.vlanId === undefined) L.push(` no switchport`);
      if (i.mode === 'trunk') {
        L.push(` switchport mode trunk`);
        L.push(` switchport trunk allowed vlan ${i.allowedVlans === 'all' ? 'all' : i.allowedVlans.join(',')}`);
        if (i.nativeVlan !== 1) L.push(` switchport trunk native vlan ${i.nativeVlan}`);
      }
      if (i.encapVlan) L.push(` encapsulation dot1Q ${i.encapVlan}`);
      if (i.ipv4) L.push(` ip address ${i.ipv4.ip} ${formatIPv4(prefixToMask(i.ipv4.prefix))}`);
      for (const v of i.ipv6.filter((x) => !x.ip.toLowerCase().startsWith('fe80'))) L.push(` ipv6 address ${v.ip}/${v.prefix}`);
      if (i.nat) L.push(` ip nat ${i.nat}`);
      if (i.zone) L.push(` zone ${i.zone}`);
      if (i.helperAddress) L.push(` ip helper-address ${i.helperAddress}`);
      L.push(i.adminUp ? ' no shutdown' : ' shutdown');
    }
    if (d.defaultGw4 && d.kind === 'switch') L.push(`ip default-gateway ${d.defaultGw4}`);
    for (const r of d.routesV4.filter((x) => x.proto === 'static')) {
      L.push(`ip route ${r.dest} ${formatIPv4(prefixToMask(r.prefix))} ${r.nexthop ?? r.iface}`);
    }
    for (const r of d.routesV6.filter((x) => x.proto === 'static')) {
      L.push(`ipv6 route ${r.dest}/${r.prefix} ${r.nexthop}`);
    }
    if (d.ospf.enabled) {
      L.push('router ospf 1');
      if (d.ospf.routerId) L.push(` router-id ${d.ospf.routerId}`);
      for (const n of d.ospf.networks) L.push(` network ${n.network} ${n.wildcard} area 0`);
    }
    for (const p of d.dhcpPools) {
      L.push(`ip dhcp pool ${p.name}`);
      if (p.network) L.push(` network ${p.network} ${formatIPv4(prefixToMask(p.prefix ?? 24))}`);
      if (p.gateway) L.push(` default-router ${p.gateway}`);
      if (p.dns) L.push(` dns-server ${p.dns}`);
    }
    for (const range of d.dhcpExcluded) {
      L.push(`ip dhcp excluded-address ${range.start}${range.end !== range.start ? ` ${range.end}` : ''}`);
    }
    for (const w of d.wifi) {
      L.push(`ssid ${w.ssid}`);
      L.push(` vlan ${w.vlan}`);
      if (w.psk) L.push(` wpa2-psk ${w.psk}`);
      L.push(` channel ${w.channel}`);
    }
    if (d.capwapController) L.push(`capwap controller ${d.capwapController}`);
    for (const w of d.wlans) {
      L.push(`wlan create ${w.ssid} vlan ${w.vlan}`);
      if (w.psk) L.push(`wpa2 psk ${w.psk}`);
    }
    for (const r of d.fwRules) {
      L.push(`policy ${r.srcZone ?? 'any'} ${r.dstZone ?? 'any'} ${r.action} ${r.proto}${r.dport ? ' ' + r.dport : ''}`);
    }
    for (const z of d.masqueradeZones) L.push(`masquerade ${z}`);
    if (d.kind === 'workstation' || d.kind === 'server') {
      L.push('! linux running state');
      for (const i of d.ifaces) {
        L.push(`! ${i.name} ${i.adminUp ? 'up' : 'down'} ${i.ipv4 ? i.ipv4.ip + '/' + i.ipv4.prefix : ''}`);
      }
      if (d.associatedSsid) L.push(`! wifi ${d.associatedSsid}`);
    }
    L.push('end');
    return L.join('\n');
  }

  reboot(d: Device): void {
    const kind = d.kind;
    const name = d.name;
    const x = d.x;
    const y = d.y;
    const id = d.id;
    const startup = [...d.startupLines];
    const fresh = createDevice(kind, name, x, y, id, d.switchProfile);
    fresh.startupLines = startup;
    this.devices.set(id, fresh);
    for (const line of startup) this.exec(id, line);
    fresh.cli.level = kind === 'switch' || kind === 'router' || kind === 'ap' || kind === 'wlc' ? 'user' : 'priv';
    this.converge();
  }

  check(): CheckResult {
    this.converge();
    const results = this.checks.map((c) => this.runOneCheck(c));
    const ok = results.every((r) => r.ok);
    this.lastCheck = { ok, results };
    return this.lastCheck;
  }

  runOneCheck(c: LabCheck): { check: LabCheck; ok: boolean; reason: string } {
    if (c.type === 'ping') {
      const r = this.ping(c.src, c.dst, { count: 1, family: c.family ?? 'v4' });
      return { check: c, ok: r.ok, reason: r.ok ? `ping ${c.src} → ${c.dst} ok` : r.reason };
    }
    if (c.type === 'ssh') {
      const r = this.getPath(c.src, c.dst, 'tcp', 'v4');
      const allow = r.ok;
      const ok = c.expect === 'allow' ? allow : !allow;
      const reason = ok
        ? `ssh ${c.src} → ${c.dst} ${c.expect} as expected`
        : `ssh ${c.src} → ${c.dst} expected ${c.expect} but ${allow ? 'allowed' : r.reason}`;
      return { check: c, ok, reason };
    }
    if (c.type === 'wifi-associated') {
      const d = this.find(c.client);
      const ok = !!d?.associatedSsid;
      return { check: c, ok, reason: ok ? `${c.client} associated to ${d!.associatedSsid}` : `${c.client} is not associated` };
    }
    if (c.type === 'dhcp-bound') {
      const d = this.find(c.device);
      const ip = d?.ifaces.find((i) => i.ipv4)?.ipv4;
      return { check: c, ok: !!ip, reason: ip ? `${c.device} has ${ip.ip}/${ip.prefix}` : `${c.device} has no IPv4 address` };
    }
    if (c.type === 'ospf-full') {
      const a = this.find(c.a);
      const b = this.find(c.b);
      this.convergeOspf();
      const st = a?.ospf.neighbors.find((n) => n.routerId === (b ? this.routerId(b) : '') || n.peerIp && b?.ifaces.some((i) => i.ipv4?.ip === n.peerIp));
      const ok = st?.state === 'FULL';
      return { check: c, ok, reason: ok ? `OSPF ${c.a} ↔ ${c.b} FULL` : `OSPF neighbor ${c.a} ↔ ${c.b} not FULL (${st?.state ?? 'missing'})` };
    }
    return { check: c, ok: false, reason: 'unknown check' };
  }

  applyPatch(patch: LabPatch): { ok: boolean; error?: string; applied: string[] } {
    const applied: string[] = [];
    try {
      for (const d of patch.addDevices ?? []) {
        if (!DEVICE_KINDS.includes(d.type)) throw new Error(`unknown device type ${d.type}`);
        this.addDevice(d.type, d.name, d.x ?? 80, d.y ?? 80, d.switchProfile);
        applied.push(`add ${d.name}`);
      }
      for (const rec of patch.setSwitchProfiles ?? []) {
        this.setSwitchProfile(rec.device, rec.switchProfile);
        applied.push(`profile ${rec.device} ${rec.switchProfile}`);
      }
      for (const id of patch.removeDeviceIds ?? []) {
        this.removeDevice(id);
        applied.push(`remove ${id}`);
      }
      for (const l of patch.addLinks ?? []) {
        this.addLink(l.a, l.b, true, l.cable ?? 'ethernet');
        applied.push(`link ${l.a} ${l.b}`);
      }
      for (const l of patch.removeLinks ?? []) this.removeLink(l);
      for (const cfg of patch.configs ?? []) {
        const dev = this.dev(cfg.device);
        for (const line of cfg.commands) {
          const r = this.exec(dev.id, line);
          if (r.error) throw new Error(`${dev.name}: ${r.output}`);
        }
        applied.push(`config ${dev.name}`);
      }
      this.recomputeStp();
      this.converge();
      return { ok: true, applied };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), applied };
    }
  }

  getState(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      goal: this.goal,
      description: this.description,
      differsNote: this.differsNote,
      warnings: this.warnings,
      lastCheck: this.lastCheck,
      highlightIds: this.highlightIds,
      devices: [...this.devices.values()].map((d) => ({
        id: d.id,
        name: d.name,
        hostname: d.hostname,
        kind: d.kind,
        switchProfile: d.switchProfile,
        ipRouting: d.ipRouting,
        dhcpPools: d.dhcpPools,
        dhcpBindings: d.dhcpBindings,
        dhcpExcluded: d.dhcpExcluded,
        x: d.x,
        y: d.y,
        associatedSsid: d.associatedSsid,
        associatedAp: d.associatedAp,
        ospfNeighbors: d.ospf.neighbors,
        sshListen: d.sshListen,
        ifaces: d.ifaces.map((i) => {
          const look = i.parent ?? i.name;
          const p = this.peer(d.id, look);
          const st = this.ifaceStatus(d, i);
          return {
            name: i.name,
            mac: i.mac,
            adminUp: i.adminUp,
            operUp: this.operUp(d, i),
            status: st.status,
            statusReason: st.reason,
            ipv4: i.ipv4,
            ipv6: i.ipv6,
            mode: i.mode,
            accessVlan: i.accessVlan,
            nativeVlan: i.nativeVlan,
            helperAddress: i.helperAddress,
            isRadio: i.isRadio,
            zone: i.zone,
            peer: p
              ? {
                  device: p.dev.name,
                  deviceId: p.dev.id,
                  iface: p.iface.name,
                  linkId: p.link.id,
                  cable: p.link.kind === 'radio' ? 'radio' : (p.link.cable ?? 'ethernet'),
                }
              : null,
          };
        }),
        runningConfig: this.runningConfig(d),
      })),
      links: this.links.map((l) => ({
        id: l.id,
        kind: l.kind,
        cable: l.kind === 'radio' ? undefined : (l.cable ?? 'ethernet'),
        ssid: l.ssid,
        a: { device: this.dev(l.a.deviceId).name, iface: l.a.iface, deviceId: l.a.deviceId },
        b: { device: this.dev(l.b.deviceId).name, iface: l.b.iface, deviceId: l.b.deviceId },
      })),
      packets: this.packets.slice(-80),
      activity: this.activity.slice(-50),
      checks: this.checks,
    };
  }
}

type OspfLsa = Device['ospf']['lsdb'][number];
type ConnHit = { kind: 'fwd' | 'rev'; e: Device['conntrack'][number] };

const KNOWN_CISCO = new Set(['switchport', 'spanning-tree', 'router', 'ipv6', 'ip', 'interface', 'vlan', 'no']);

function tokenize(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}
function out(output: string): CliResult {
  return { output, prompt: '', events: [] };
}
function err(output: string): CliResult {
  return { output, prompt: '', error: true, events: [] };
}
function fmtPkt(p: PacketEvent): string {
  return `${p.t}ms ${p.from.device}:${p.from.iface} ${p.proto} ${p.srcIp ?? p.srcMac} → ${p.dstIp ?? p.dstMac} ${p.reason}${p.drop ? ' DROP' : ''}`;
}

export { allocMac };
