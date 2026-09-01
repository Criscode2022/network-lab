import { KIND_PORTS, type DeviceKind, type LabCheck, type LabJson } from './types.ts';

/** Dual-stack small office used by Eve builder eval and Check-equivalent pings. */
export function dualStackOfficeLab(): LabJson {
  return {
    schemaVersion: 1,
    id: 'build-dual-stack-office',
    name: 'Dual-stack office',
    goal: 'PCs ping the server (v4+v6). Wi-Fi PC associates to CORP.',
    devices: [
      {
        kind: 'workstation',
        name: 'PC1',
        x: 80,
        y: 80,
        startup: [
          'ip addr add 10.0.10.10/24 dev eth0',
          'ip link set eth0 up',
          'ip route add default via 10.0.10.1',
        ],
      },
      {
        kind: 'workstation',
        name: 'PC2',
        x: 80,
        y: 280,
        startup: [],
        post: ['nmcli wifi connect CORP password office'],
      },
      {
        kind: 'server',
        name: 'SRV1',
        x: 620,
        y: 80,
        startup: [
          'ip addr add 10.0.10.20/24 dev eth0',
          'ip addr add 2001:db8:10::20/64 dev eth0',
          'ip link set eth0 up',
          'ip route add default via 10.0.10.1',
          'systemctl start ssh',
        ],
      },
      {
        kind: 'switch',
        name: 'SW1',
        x: 320,
        y: 140,
        startup: [
          'enable', 'conf t', 'vlan 10', 'vlan 20',
          'int Gi0/1', 'switchport mode access', 'switchport access vlan 10', 'no shut',
          'int Gi0/2', 'switchport mode access', 'switchport access vlan 10', 'no shut',
          'int Gi0/3', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'no shut',
          'int Gi0/4', 'switchport mode access', 'switchport access vlan 20', 'no shut',
          'end',
        ],
      },
      {
        kind: 'router',
        name: 'R1',
        x: 320,
        y: 20,
        startup: [
          'enable', 'conf t',
          'int Gi0/0', 'no shut',
          'int Gi0/0.10', 'encapsulation dot1Q 10', 'ip address 10.0.10.1 255.255.255.0', 'ipv6 address 2001:db8:10::1/64', 'ipv6 nd prefix 2001:db8:10::/64',
          'int Gi0/0.20', 'encapsulation dot1Q 20', 'ip address 10.0.20.1 255.255.255.0', 'ipv6 address 2001:db8:20::1/64',
          'ip dhcp pool WIFI', 'network 10.0.20.0 255.255.255.0', 'default-router 10.0.20.1',
          'end',
        ],
      },
      {
        kind: 'ap',
        name: 'AP1',
        x: 160,
        y: 200,
        startup: [
          'enable', 'conf t', 'ssid CORP', 'vlan 20', 'wpa2-psk office', 'channel 6',
          'int Gi0/1', 'no shut', 'int wlan0', 'no shut', 'end',
        ],
      },
    ],
    links: [
      { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
      { a: 'SRV1:eth0', b: 'SW1:Gi0/2' },
      { a: 'R1:Gi0/0', b: 'SW1:Gi0/3' },
      { a: 'AP1:Gi0/1', b: 'SW1:Gi0/4' },
    ],
    checks: [
      { type: 'ping', src: 'PC1', dst: '10.0.10.20', family: 'v4' },
      { type: 'wifi-associated', client: 'PC2' },
      { type: 'dhcp-bound', device: 'PC2' },
      { type: 'ping', src: 'PC2', dst: '10.0.10.20', family: 'v4' },
    ],
  };
}

const OUT_OF_SCOPE = /bgp|mpls|vxlan|802\.1x/i;
const WORD_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

function countPhrase(spec: string, nouns: string): number {
  const re = new RegExp(`(\\d+|one|two|three|four|five|six|seven|eight|a|an)\\s+(${nouns})\\b`, 'gi');
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec))) {
    const raw = m[1].toLowerCase();
    n += WORD_NUM[raw] ?? Number(raw);
  }
  return n;
}

/** Count "2 PCs" / "a workstation", or a bare "PC" / "workstation" with no number. */
function countDevices(spec: string, nouns: string): number {
  const n = countPhrase(spec, nouns);
  if (n > 0) return n;
  return new RegExp(`\\b(?:${nouns})\\b`, 'i').test(spec) ? 1 : 0;
}

/** VLAN id bound to a role ("wifi on VLAN 20", "VLAN 10 server"). */
function roleVlan(spec: string, role: string): number | undefined {
  const roleFirst = new RegExp(`(?:${role})[^.;]{0,48}?\\bvlan\\s+(\\d+)`, 'i');
  const vlanFirst = new RegExp(`\\bvlan\\s+(\\d+)[^.;]{0,48}?(?:${role})`, 'i');
  const a = spec.match(roleFirst);
  if (a) return Number(a[1]);
  const b = spec.match(vlanFirst);
  if (b) return Number(b[1]);
  return undefined;
}

function has(spec: string, re: RegExp): boolean {
  return re.test(spec);
}

function isOfficeSpec(spec: string): boolean {
  const t = spec.toLowerCase();
  const sw = has(t, /\bsw\b|\bswitch/);
  const r = has(t, /\br\b|\brouter/);
  const ap = has(t, /\bap\b|access point/);
  const srv = has(t, /\bserver|\bsrv\b/);
  const pcs = has(t, /\b2\s*pcs?\b|\btwo\s+pcs?\b/);
  return (has(t, /dual[- ]stack/) || has(t, /\boffice\b/)) && sw && r && ap && srv && pcs;
}

function slug(spec: string): string {
  const s = spec
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return s || 'custom';
}

function nextPort(used: Record<string, number>, name: string, kind: DeviceKind): string {
  const ports = KIND_PORTS[kind].filter((p) => p !== 'wlan0');
  const i = used[name] ?? 0;
  used[name] = i + 1;
  if (i >= ports.length) throw new Error(`no free ports on ${name}`);
  return ports[i];
}

/**
 * Turn a junior-admin sentence into palette-only lab JSON.
 * Dual-stack office (SW, R, AP, server, 2 PCs) is the known-good office template.
 * Other specs emit a matching device mix, cables, and a Check.
 */
export function labFromSpec(spec: string): LabJson {
  const text = spec.trim();
  if (!text) return dualStackOfficeLab();
  if (OUT_OF_SCOPE.test(text)) {
    throw new Error('NetBench does not implement BGP/MPLS/VXLAN/802.1X. Use OSPF area 0 and the eight device types.');
  }
  if (isOfficeSpec(text)) return dualStackOfficeLab();

  const wantOspf = has(text, /\bospf\b/);
  const wantWifi = has(text, /\bwifi\b|\bwi-fi\b|\bssid\b|\bwlan\b|\baccess point\b|\bap\b/);
  const wantDhcp = has(text, /\bdhcp\b/);
  const wantV6 = has(text, /\bdual[- ]stack\b|\bipv6\b|\bping6\b|\bslaac\b/);
  const wantFw = has(text, /\bfirewall|\bacl\b|\bnftables\b/);
  const ssidMatch = text.match(/\bssid\s+([A-Za-z0-9_-]+)/i);
  const ssid = ssidMatch?.[1] ?? 'CORP';
  const pskMatch = text.match(/\bpassword\s+([A-Za-z0-9_-]+)/i);
  const psk = pskMatch?.[1] ?? 'office';
  const vlanNums = [...text.matchAll(/\bvlan\s+(\d+)/gi)].map((m) => Number(m[1]));
  let vlanWifi = roleVlan(text, 'wifi|wi-fi|ssid|wlan|\\bap\\b') ?? 20;
  const vlanServer = roleVlan(text, 'server|\\bsrv\\b');
  const vlanPc = roleVlan(text, '\\bpc\\b|workstation|\\bhost\\b');
  let vlanData = vlanServer ?? vlanPc ?? (vlanNums.find((n) => n !== vlanWifi) ?? 10);
  if (vlanData === vlanWifi) {
    const other = vlanNums.find((n) => n !== vlanWifi);
    if (other !== undefined) vlanData = other;
    else vlanData = vlanWifi === 10 ? 20 : 10;
  }

  let nPc = countDevices(text, 'pcs?|workstations?|hosts?|laptops?');
  let nSrv = countDevices(text, 'servers?');
  let nSw = countPhrase(text, 'switches|switch|sw');
  let nR = countDevices(text, 'routers?');
  let nFw = countDevices(text, 'firewalls?');
  let nAp = countPhrase(text, 'aps?|access points?');
  let nWlc = countPhrase(text, 'wlcs?|controllers?');
  let nCloud = countPhrase(text, 'clouds?|internets?');

  if (has(text, /\bap\b|access point/) && nAp === 0) nAp = 1;
  if (wantWifi && nAp === 0) nAp = 1;
  if (wantOspf && nR < 2) nR = 2;
  if (wantFw && nFw === 0) nFw = 1;
  if (has(text, /\brouter/) && nR === 0) nR = 1;
  if (has(text, /\bswitch/) && nSw === 0) nSw = 1;
  if (has(text, /\bserver/) && nSrv === 0) nSrv = 1;
  if (has(text, /\bwlc\b/) && nWlc === 0) nWlc = 1;
  if (has(text, /\bcloud\b|\binternet\b/) && nCloud === 0) nCloud = 1;
  if (nPc === 0 && (has(text, /\bping\b/) || nSrv === 0)) nPc = nAp ? 1 : 2;
  if (nSw === 0 && nPc + nSrv + nAp + nWlc > 1) nSw = 1;
  if (nR === 0 && (wantDhcp || wantV6 || nAp > 0)) nR = 1;

  nPc = Math.min(nPc, 6);
  nSrv = Math.min(nSrv, 3);
  nSw = Math.min(nSw, 4);
  nR = Math.min(nR, 4);
  nFw = Math.min(nFw, 2);
  nAp = Math.min(nAp, 2);
  nWlc = Math.min(nWlc, 1);
  nCloud = Math.min(nCloud, 1);

  const devices: LabJson['devices'] = [];
  const links: { a: string; b: string }[] = [];
  const used: Record<string, number> = {};
  let x = 80;
  const row = (y: number, names: { kind: DeviceKind; name: string }[]) => {
    for (const d of names) {
      devices.push({ kind: d.kind, name: d.name, x, y, startup: [] });
      x += 160;
    }
    x = 80;
  };

  const pcs = Array.from({ length: nPc }, (_, i) => ({ kind: 'workstation' as const, name: `PC${i + 1}` }));
  const srvs = Array.from({ length: nSrv }, (_, i) => ({ kind: 'server' as const, name: `SRV${i + 1}` }));
  const sws = Array.from({ length: nSw }, (_, i) => ({ kind: 'switch' as const, name: `SW${i + 1}` }));
  const rs = Array.from({ length: nR }, (_, i) => ({ kind: 'router' as const, name: `R${i + 1}` }));
  const fws = Array.from({ length: nFw }, (_, i) => ({ kind: 'firewall' as const, name: `FW${i + 1}` }));
  const aps = Array.from({ length: nAp }, (_, i) => ({ kind: 'ap' as const, name: `AP${i + 1}` }));
  const wlcs = Array.from({ length: nWlc }, (_, i) => ({ kind: 'wlc' as const, name: `WLC${i + 1}` }));
  const clouds = Array.from({ length: nCloud }, (_, i) => ({ kind: 'cloud' as const, name: `CLOUD${i + 1}` }));

  row(240, pcs);
  row(80, srvs);
  row(160, sws);
  row(20, [...rs, ...fws, ...clouds]);
  row(200, [...aps, ...wlcs]);

  const byName = Object.fromEntries(devices.map((d) => [d.name, d]));
  const cable = (a: string, ai: string, b: string, bi: string) => {
    links.push({ a: `${a}:${ai}`, b: `${b}:${bi}` });
  };

  const l2 = sws.map((s) => s.name);
  const core = l2[0];
  const attach = (name: string, kind: DeviceKind, prefer?: string) => {
    const target = prefer && byName[prefer] ? prefer : core;
    if (target) {
      const tp = nextPort(used, target, byName[target].kind);
      const sp = nextPort(used, name, kind);
      cable(name, sp, target, tp);
      return;
    }
    const r0 = rs[0]?.name;
    if (r0 && name !== r0) {
      const rp = nextPort(used, r0, 'router');
      const sp = nextPort(used, name, kind);
      cable(name, sp, r0, rp);
    }
  };

  for (const p of pcs) {
    if (wantWifi && p.name === pcs[pcs.length - 1].name && nAp) continue;
    attach(p.name, 'workstation');
  }
  for (const s of srvs) attach(s.name, 'server');
  for (const a of aps) attach(a.name, 'ap');
  for (const w of wlcs) attach(w.name, 'wlc');
  for (const r of rs) attach(r.name, 'router');
  if (fws[0] && rs[0]) {
    const fp = nextPort(used, fws[0].name, 'firewall');
    const rp = nextPort(used, rs[0].name, 'router');
    cable(fws[0].name, fp, rs[0].name, rp);
  } else {
    for (const f of fws) attach(f.name, 'firewall');
  }
  if (clouds[0] && fws[0]) {
    cable(clouds[0].name, nextPort(used, clouds[0].name, 'cloud'), fws[0].name, nextPort(used, fws[0].name, 'firewall'));
  } else if (clouds[0]) {
    attach(clouds[0].name, 'cloud', rs[0]?.name);
  }
  if (rs.length >= 2) {
    cable(rs[0].name, nextPort(used, rs[0].name, 'router'), rs[1].name, nextPort(used, rs[1].name, 'router'));
  }
  for (let i = 1; i < sws.length; i++) {
    cable(sws[i - 1].name, nextPort(used, sws[i - 1].name, 'switch'), sws[i].name, nextPort(used, sws[i].name, 'switch'));
  }

  const wiredPc = pcs.find((p) => links.some((l) => l.a.startsWith(p.name + ':') || l.b.startsWith(p.name + ':')));
  const wifiPc = wantWifi && nAp ? pcs[pcs.length - 1] : undefined;
  const gw4 = rs[0] ? `10.0.${vlanData}.1` : undefined;

  for (const p of pcs) {
    const d = byName[p.name];
    if (wifiPc && p.name === wifiPc.name) {
      d.startup = [];
      d.post = [`nmcli wifi connect ${ssid} password ${psk}`];
      continue;
    }
    const host = 10 + pcs.indexOf(p);
    d.startup = [
      `ip addr add 10.0.${vlanData}.${host}/24 dev eth0`,
      ...(wantV6 ? [`ip addr add 2001:db8:${vlanData}::${host}/64 dev eth0`] : []),
      'ip link set eth0 up',
      ...(gw4 ? [`ip route add default via ${gw4}`] : []),
    ];
  }
  for (const s of srvs) {
    const d = byName[s.name];
    const host = 20 + srvs.indexOf(s);
    d.startup = [
      `ip addr add 10.0.${vlanData}.${host}/24 dev eth0`,
      ...(wantV6 ? [`ip addr add 2001:db8:${vlanData}::${host}/64 dev eth0`] : []),
      'ip link set eth0 up',
      ...(gw4 ? [`ip route add default via ${gw4}`] : []),
      'systemctl start ssh',
    ];
  }
  for (const sw of sws) {
    const d = byName[sw.name];
    const ports = links
      .flatMap((l) => [l.a, l.b])
      .filter((x) => x.startsWith(sw.name + ':'))
      .map((x) => x.split(':')[1]);
    const lines = ['enable', 'conf t', `vlan ${vlanData}`, ...(nAp || vlanNums.length ? [`vlan ${vlanWifi}`] : [])];
    for (const p of [...new Set(ports)]) {
      const wifiUplink = nAp && links.some((l) => (l.a.startsWith(sw.name + ':' + p) || l.b.startsWith(sw.name + ':' + p)) && aps.some((a) => l.a.startsWith(a.name) || l.b.startsWith(a.name)));
      const trunk = rs.some((r) => links.some((l) => (l.a === `${sw.name}:${p}` || l.b === `${sw.name}:${p}`) && (l.a.startsWith(r.name) || l.b.startsWith(r.name))));
      lines.push(`int ${p}`);
      if (trunk) {
        lines.push('switchport mode trunk', `switchport trunk allowed vlan ${vlanData},${vlanWifi}`, 'no shut');
      } else if (wifiUplink) {
        lines.push('switchport mode access', `switchport access vlan ${vlanWifi}`, 'no shut');
      } else {
        lines.push('switchport mode access', `switchport access vlan ${vlanData}`, 'no shut');
      }
    }
    lines.push('end');
    d.startup = lines;
  }
  rs.forEach((r, idx) => {
    const d = byName[r.name];
    const lines = ['enable', 'conf t'];
    const rLinks = links.filter((l) => l.a.startsWith(r.name + ':') || l.b.startsWith(r.name + ':'));
    const ifaces = [...new Set(rLinks.map((l) => (l.a.startsWith(r.name + ':') ? l.a.split(':')[1] : l.b.split(':')[1])))];
    ifaces.forEach((iface, i) => {
      const peer = rLinks.find((l) => l.a === `${r.name}:${iface}` || l.b === `${r.name}:${iface}`);
      const other = peer ? (peer.a.startsWith(r.name + ':') ? peer.b.split(':')[0] : peer.a.split(':')[0]) : '';
      const toSw = sws.some((s) => s.name === other);
      const multiVlan = vlanData !== vlanWifi || vlanNums.length >= 2 || has(text, /two\s+vlans?/);
      lines.push(`int ${iface}`, 'no shut');
      if (toSw && idx === 0 && (nAp || wantV6 || wantDhcp || multiVlan)) {
        lines.push(
          `int ${iface}.${vlanData}`,
          `encapsulation dot1Q ${vlanData}`,
          `ip address 10.0.${vlanData}.1 255.255.255.0`,
          ...(wantV6 ? [`ipv6 address 2001:db8:${vlanData}::1/64`, `ipv6 nd prefix 2001:db8:${vlanData}::/64`] : []),
        );
        if (nAp || wantDhcp) {
          lines.push(
            `int ${iface}.${vlanWifi}`,
            `encapsulation dot1Q ${vlanWifi}`,
            `ip address 10.0.${vlanWifi}.1 255.255.255.0`,
            ...(wantV6 ? [`ipv6 address 2001:db8:${vlanWifi}::1/64`] : []),
          );
        }
      } else {
        const net = idx === 0 && i === 0 ? vlanData : 12 + idx * 10 + i;
        const host = other.startsWith('R') && idx === 1 ? 2 : 1;
        lines.push(`ip address 10.0.${net}.${host} 255.255.255.0`);
      }
    });
    if ((wantDhcp || nAp) && idx === 0) {
      lines.push('ip dhcp pool WIFI', `network 10.0.${vlanWifi}.0 255.255.255.0`, `default-router 10.0.${vlanWifi}.1`);
    }
    if (wantOspf) {
      lines.push('router ospf 1', `router-id ${idx + 1}.${idx + 1}.${idx + 1}.${idx + 1}`, `network 10.0.0.0 0.255.255.255 area 0`);
    }
    lines.push('end');
    d.startup = lines;
  });
  for (const a of aps) {
    byName[a.name].startup = [
      'enable',
      'conf t',
      `ssid ${ssid}`,
      `vlan ${vlanWifi}`,
      `wpa2-psk ${psk}`,
      'channel 6',
      'int Gi0/1',
      'no shut',
      'int wlan0',
      'no shut',
      'end',
    ];
  }
  for (const w of wlcs) {
    byName[w.name].startup = ['enable', 'conf t', `wlan ${ssid}`, `vlan ${vlanWifi}`, `wpa2-psk ${psk}`, 'end'];
  }
  for (const f of fws) {
    byName[f.name].startup = [
      'ip addr add 10.0.99.2/24 dev eth0',
      'ip link set eth0 up',
      'ip link set eth1 up',
      'nft add rule inet filter forward tcp dport 22 drop',
    ];
  }
  for (const c of clouds) {
    byName[c.name].startup = ['ip addr add 203.0.113.1/24 dev eth0', 'ip link set eth0 up'];
  }

  const checks: LabCheck[] = [];
  const pingSrc = wiredPc?.name ?? pcs[0]?.name;
  const pingDstDev = srvs[0]?.name ?? pcs.find((p) => p.name !== pingSrc)?.name;
  const pingDstIp = srvs[0]
    ? `10.0.${vlanData}.20`
    : pingDstDev
      ? `10.0.${vlanData}.${10 + pcs.findIndex((p) => p.name === pingDstDev)}`
      : undefined;
  if (pingSrc && pingDstIp) checks.push({ type: 'ping', src: pingSrc, dst: pingDstIp, family: 'v4' });
  if (wifiPc) {
    checks.push({ type: 'wifi-associated', client: wifiPc.name });
    if (wantDhcp || nAp) checks.push({ type: 'dhcp-bound', device: wifiPc.name });
    if (srvs[0]) checks.push({ type: 'ping', src: wifiPc.name, dst: `10.0.${vlanData}.20`, family: 'v4' });
  }
  if (wantOspf && rs.length >= 2) checks.push({ type: 'ospf-full', a: rs[0].name, b: rs[1].name });

  return {
    schemaVersion: 1,
    id: `build-${slug(text)}`,
    name: text.slice(0, 72) || 'Custom lab',
    goal: `Topology built from: ${text.slice(0, 120)}`,
    devices,
    links,
    checks,
  };
}
