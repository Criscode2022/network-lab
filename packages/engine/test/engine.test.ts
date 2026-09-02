import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.ts';
import { listCommands } from '../src/commands.ts';
import { BUILTIN_LABS } from '../src/labs.ts';
import { dualStackOfficeLab, labFromSpec } from '../src/build.ts';
import { validatePatch } from '../src/patch.ts';
import { labStartupErrors, validateLab } from '../src/validate.ts';
import type { LabJson } from '../src/types.ts';

function twoPcSwitch(extra?: Partial<LabJson>): LabJson {
  return {
    schemaVersion: 1,
    id: 't-l2',
    name: 't',
    devices: [
      { kind: 'workstation', name: 'PC1', x: 0, y: 0, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
      { kind: 'workstation', name: 'PC2', x: 200, y: 0, startup: ['ip addr add 10.0.0.20/24 dev eth0', 'ip link set eth0 up'] },
      { kind: 'switch', name: 'SW1', x: 100, y: 0, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'] },
    ],
    links: [
      { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
      { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    ],
    checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20' }],
    ...extra,
  };
}

describe('IPv4 ping + Linux/switch CLI', () => {
  it('toLab round-trips live IPs and cables for guest restore', () => {
    const e = Engine.fromLab(twoPcSwitch());
    e.addDevice('workstation', 'PC3', 40, 40);
    e.addLink('PC3:eth0', 'SW1:Gi0/3');
    e.exec('PC3', 'ip addr add 10.0.0.30/24 dev eth0');
    e.exec('PC3', 'ip link set eth0 up');
    const lab = e.toLab();
    const e2 = Engine.fromLab(lab);
    expect(e2.dev('PC3').ifaces[0].ipv4?.ip).toBe('10.0.0.30');
    expect(e2.operUp(e2.dev('PC3'), e2.dev('PC3').ifaces[0])).toBe(true);
    const ping = e2.ping('PC1', '10.0.0.20', { count: 1 });
    expect(ping.ok, ping.reason).toBe(true);
  });

  it('two PCs on a switch ping after ip addr/link', () => {
    const e = Engine.fromLab(twoPcSwitch());
    const r = e.ping('PC1', '10.0.0.20', { count: 1 });
    expect(r.ok, r.reason).toBe(true);
    expect(r.events.some((p) => p.proto === 'ARP')).toBe(true);
    expect(r.events.some((p) => p.reason.includes('echo reply'))).toBe(true);
    const show = e.exec('PC1', 'ip addr');
    expect(show.output).toContain('10.0.0.10/24');
    const run = e.exec('SW1', 'show run');
    expect(run.output).toContain('interface Gi0/1');
  });

  it('unknown CLI fails honestly', () => {
    const e = Engine.fromLab(twoPcSwitch());
    const l = e.exec('PC1', 'bgp neighbor 1.1.1.1');
    expect(l.error).toBe(true);
    expect(l.output.toLowerCase()).toContain('not found');
    const c = e.exec('SW1', 'router bgp 65000');
    expect(c.error).toBe(true);
    expect(c.output.toLowerCase()).toMatch(/unknown command|unsupported|not found/);
  });

  it('cancel() interrupts ping with ^C', () => {
    const e = Engine.fromLab(twoPcSwitch());
    const drain = e.drain.bind(e);
    e.drain = (max?: number) => {
      e.cancel();
      drain(max);
    };
    const r = e.ping('PC1', '10.0.0.20', { count: 8 });
    expect(r.reason).toMatch(/\^C|interrupted/i);
    expect(r.ok).toBe(false);
  });

  it('shutdown iface drops ping with exact reason', () => {
    const e = Engine.fromLab(twoPcSwitch());
    e.exec('PC2', 'ip link set eth0 down');
    const r = e.ping('PC1', '10.0.0.20', { count: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toMatch(/down|arp timeout/);
  });
});

describe('VLANs and static routing', () => {
  it('isolates access VLANs', () => {
    const lab: LabJson = {
      schemaVersion: 1,
      id: 'vlan-iso',
      name: 'vlan',
      devices: [
        { kind: 'workstation', name: 'PC1', x: 0, y: 0, startup: ['ip addr add 10.0.10.10/24 dev eth0', 'ip link set eth0 up'] },
        { kind: 'workstation', name: 'PC2', x: 1, y: 0, startup: ['ip addr add 10.0.10.20/24 dev eth0', 'ip link set eth0 up'] },
        {
          kind: 'switch',
          name: 'SW1',
          x: 2,
          y: 0,
          startup: [
            'enable', 'conf t', 'vlan 10', 'vlan 20',
            'int Gi0/1', 'switchport mode access', 'switchport access vlan 10', 'no shut',
            'int Gi0/2', 'switchport mode access', 'switchport access vlan 20', 'no shut',
            'end',
          ],
        },
      ],
      links: [
        { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
        { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
      ],
      checks: [],
    };
    const e = Engine.fromLab(lab);
    const r = e.ping('PC1', '10.0.10.20', { count: 1 });
    expect(r.ok).toBe(false);
  });

  it('router-on-a-stick forwards inter-VLAN; missing subif drops with that reason', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-3-vlans-roas')!);
    expect(e.ping('PC1', '10.0.20.20', { count: 1 }).ok).toBe(true);
    e.exec('R1', 'enable');
    e.exec('R1', 'conf t');
    e.exec('R1', 'int Gi0/0.20');
    e.exec('R1', 'shutdown');
    const r = e.ping('PC1', '10.0.20.20', { count: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toMatch(/down|no subinterface|no route|arp/);
  });

  it('static v4 via a router', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-2-missing-gateway')!);
    expect(e.ping('PC1', '10.0.1.20', { count: 1 }).ok).toBe(true);
    e.exec('PC1', 'ip route add default via 10.0.0.9');
    const broken = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-2-missing-gateway')!);
    broken.exec('PC1', 'ip addr add 10.0.0.10/24 dev eth0');
    const pc = broken.find('PC1')!;
    pc.defaultGw4 = undefined;
    pc.routesV4 = pc.routesV4.filter((x) => x.prefix !== 0);
    const r = broken.ping('PC1', '10.0.1.20', { count: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toMatch(/no route|gateway/);
  });
});

describe('IPv6 SLAAC + ping6 + static v6', () => {
  it('SLAAC then ping6', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-5-slaac-ping6')!);
    const pc1 = e.find('PC1')!;
    const glob = pc1.ifaces[0].ipv6.find((v) => v.slaac || v.ip.startsWith('2001:'));
    expect(glob?.ip).toBeTruthy();
    const r = e.ping('PC1', 'PC2', { count: 1, family: 'v6' });
    expect(r.ok, r.reason).toBe(true);
  });
});

describe('OSPFv2 area 0', () => {
  it('neighbors FULL and installs routes', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-6-ospf-area0')!);
    const r1 = e.find('R1')!;
    expect(r1.ospf.neighbors.some((n) => n.state === 'FULL')).toBe(true);
    expect(r1.routesV4.some((r) => r.proto === 'ospf' && r.dest.startsWith('10.0.2.'))).toBe(true);
    const ping = e.ping('PC1', '10.0.2.10', { count: 1 });
    expect(ping.ok, ping.reason).toBe(true);
  });

  it('missing network statement leaves neighbor down', () => {
    const lab = structuredClone(BUILTIN_LABS.find((l) => l.id === 'lab-6-ospf-area0')!);
    const r2 = lab.devices.find((d) => d.name === 'R2')!;
    r2.startup = (r2.startup ?? []).filter((l) => !l.includes('network 10.0.12'));
    const e = Engine.fromLab(lab);
    const chk = e.runOneCheck({ type: 'ospf-full', a: 'R1', b: 'R2' });
    expect(chk.ok).toBe(false);
    expect(chk.reason.toLowerCase()).toMatch(/not full|missing/);
  });
});

describe('DHCP, wifi, firewall, NAT, TTL, loop', () => {
  it('DHCPv4 assigns an address', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-4-dhcpv4')!);
    const pc = e.find('PC1')!;
    expect(pc.ifaces[0].ipv4?.ip).toMatch(/^192\.168\.1\./);
    expect(e.ping('PC1', '192.168.1.1', { count: 1 }).ok).toBe(true);
  });

  it('wifi associate then ping wired server', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-7-wifi-dhcp-ping')!);
    expect(e.find('PC1')?.associatedSsid).toBe('CORP');
    const r = e.ping('PC1', '10.0.10.10', { count: 1 });
    expect(r.ok, r.reason).toBe(true);
  });

  it('wifi not associated fails with association reason', () => {
    const lab = structuredClone(BUILTIN_LABS.find((l) => l.id === 'lab-7-wifi-dhcp-ping')!);
    const pc = lab.devices.find((d) => d.name === 'PC1')!;
    pc.post = [];
    const e = Engine.fromLab(lab);
    const r = e.ping('PC1', '10.0.10.10', { count: 1 });
    expect(r.ok).toBe(false);
    expect(e.find('PC1')?.associatedSsid).toBeUndefined();
    const nm = listCommands('workstation').some((c) => c.cmd.includes('nmcli wifi connect'));
    expect(nm).toBe(true);
  });

  it('ACL drop on firewall', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-8-firewall-ssh')!);
    const allow = e.getPath('JUMP', '10.0.30.10', 'tcp', 'v4');
    expect(allow.ok, allow.reason).toBe(true);
    const deny = e.getPath('WIFI-PC', '10.0.30.10', 'tcp', 'v4');
    expect(deny.ok).toBe(false);
    expect(deny.reason.toLowerCase()).toMatch(/acl drop|deny/);
  });

  it('NAT LAN to Internet (8.8.8.8)', () => {
    const lab: LabJson = {
      schemaVersion: 1,
      id: 'nat',
      name: 'nat',
      devices: [
        { kind: 'workstation', name: 'PC1', x: 0, y: 0, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.0.1'] },
        {
          kind: 'router',
          name: 'R1',
          x: 1,
          y: 0,
          startup: [
            'enable', 'conf t',
            'int Gi0/0', 'ip address 10.0.0.1 255.255.255.0', 'ip nat inside', 'no shut',
            'int Gi0/1', 'ip address 203.0.113.2 255.255.255.0', 'ip nat outside', 'no shut',
            'ip access-list standard NAT', 'permit 10.0.0.0 0.0.0.255',
            'ip nat inside source list NAT interface Gi0/1 overload',
            'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
            'end',
          ],
        },
        { kind: 'cloud', name: 'INET', x: 2, y: 0, startup: [] },
      ],
      links: [
        { a: 'PC1:eth0', b: 'R1:Gi0/0' },
        { a: 'R1:Gi0/1', b: 'INET:eth0' },
      ],
      checks: [],
    };
    const e = Engine.fromLab(lab);
    const r = e.ping('PC1', '8.8.8.8', { count: 1 });
    expect(r.ok, r.reason).toBe(true);
    expect(r.events.some((p) => p.srcIp === '203.0.113.2' || p.reason.includes('203.0.113.2'))).toBe(true);
  });

  it('ICMP TTL expiry reason', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-2-missing-gateway')!);
    const r = e.ping('PC1', '10.0.1.20', { count: 1, ttl: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toMatch(/ttl expired/);
  });

  it('L2 loop is broken with RSTP-lite warning', () => {
    const lab: LabJson = {
      schemaVersion: 1,
      id: 'loop',
      name: 'loop',
      devices: [
        { kind: 'workstation', name: 'PC1', x: 0, y: 0, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
        { kind: 'workstation', name: 'PC2', x: 1, y: 0, startup: ['ip addr add 10.0.0.20/24 dev eth0', 'ip link set eth0 up'] },
        { kind: 'switch', name: 'SW1', x: 0, y: 1, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'int Gi0/3', 'no shut', 'end'] },
        { kind: 'switch', name: 'SW2', x: 1, y: 1, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'int Gi0/3', 'no shut', 'end'] },
        { kind: 'switch', name: 'SW3', x: 2, y: 1, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'int Gi0/3', 'no shut', 'end'] },
      ],
      links: [
        { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
        { a: 'PC2:eth0', b: 'SW2:Gi0/1' },
        { a: 'SW1:Gi0/2', b: 'SW2:Gi0/2' },
        { a: 'SW2:Gi0/3', b: 'SW3:Gi0/1' },
        { a: 'SW3:Gi0/2', b: 'SW1:Gi0/3' },
      ],
      checks: [],
    };
    const e = Engine.fromLab(lab);
    expect(e.warnings.some((w) => w.startsWith('RSTP-lite'))).toBe(true);
    const r = e.ping('PC1', '10.0.0.20', { count: 1 });
    expect(r.ok, r.reason).toBe(true);
  });
});

describe('built-in labs Check', () => {
  /** Fault labs start failing and must pass once the fix named in their goal is applied. */
  const FIX: Record<string, (e: Engine) => void> = {
    'lab-0a-plug-the-cable': (e) => e.addLink('PC2:eth0', 'SW1:Gi0/2', true, 'ethernet'),
    'lab-0b-first-address': (e) => e.exec('PC2', 'ip addr add 10.0.0.20/24 dev eth0'),
    'lab-0c-port-shutdown': (e) => {
      for (const l of ['enable', 'conf t', 'int Gi0/2', 'no shut', 'end']) e.exec('SW1', l);
    },
    'lab-2b-wrong-mask': (e) => {
      e.exec('PC2', 'ip addr del 10.0.0.200/25 dev eth0');
      e.exec('PC2', 'ip addr add 10.0.0.200/24 dev eth0');
    },
    'lab-9-static-routes': (e) => {
      for (const l of ['enable', 'conf t', 'ip route 10.2.2.0 255.255.255.0 10.0.12.2', 'end']) e.exec('R1', l);
      for (const l of ['enable', 'conf t', 'ip route 10.1.1.0 255.255.255.0 10.0.12.1', 'end']) e.exec('R2', l);
    },
    'lab-10-ospf-three-routers': (e) => {
      for (const l of ['enable', 'conf t', 'router ospf 1', 'network 10.0.13.0 0.0.0.3 area 0', 'network 10.0.23.0 0.0.0.3 area 0', 'network 10.3.3.0 0.0.0.255 area 0', 'end']) e.exec('R3', l);
    },
    'lab-11-nat-internet': (e) => {
      for (const l of ['enable', 'conf t', 'ip access-list standard LAN', 'permit 192.168.1.0 0.0.0.255', 'ip nat inside source list LAN interface Gi0/1 overload', 'end']) e.exec('R1', l);
    },
    'lab-12-wlc-capwap': (e) => {
      for (const l of ['enable', 'conf t', 'capwap controller 10.0.10.5', 'end']) e.exec('AP1', l);
      e.exec('PC1', 'nmcli wifi connect CORP password netbench');
    },
  };

  it('has a curriculum of 17 labs with unique ids', () => {
    expect(BUILTIN_LABS).toHaveLength(17);
    expect(new Set(BUILTIN_LABS.map((l) => l.id)).size).toBe(BUILTIN_LABS.length);
    expect(BUILTIN_LABS[0].id).toBe('lab-0a-plug-the-cable');
  });

  it('study labs pass as shipped', () => {
    for (const lab of BUILTIN_LABS.filter((l) => !FIX[l.id])) {
      const chk = Engine.fromLab(lab).check();
      expect(chk.ok, `${lab.id}: ${chk.results.filter((r) => !r.ok).map((r) => r.reason).join('; ')}`).toBe(true);
    }
  });

  it('fault labs fail as shipped and pass after the documented fix', () => {
    for (const lab of BUILTIN_LABS.filter((l) => FIX[l.id])) {
      const e = Engine.fromLab(lab);
      expect(e.check().ok, `${lab.id} should start broken`).toBe(false);
      FIX[lab.id](e);
      e.converge();
      const chk = e.check();
      expect(chk.ok, `${lab.id}: ${chk.results.filter((r) => !r.ok).map((r) => r.reason).join('; ')}`).toBe(true);
    }
  });

  it('wrong mask drops on the way back with an honest reason', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-2b-wrong-mask')!);
    const p = e.getPath('PC1', '10.0.0.200', 'icmp', 'v4');
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/No route to 10\.0\.0\.10 on PC2/);
  });
});

describe('Eve eval scenarios (engine, no dummy LLM)', () => {
  it('eval1: shutdown iface — reason names shutdown / no shutdown', () => {
    const e = Engine.fromLab(twoPcSwitch());
    e.exec('SW1', 'enable');
    e.exec('SW1', 'conf t');
    e.exec('SW1', 'int Gi0/2');
    e.exec('SW1', 'shutdown');
    const r = e.ping('PC1', '10.0.0.20', { count: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toMatch(/down|no cable|arp timeout/);
    e.exec('SW1', 'no shutdown');
    expect(e.ping('PC1', '10.0.0.20', { count: 1 }).ok).toBe(true);
  });

  it('eval2: inter-VLAN without subifs — engine says no subinterface', () => {
    const lab = structuredClone(BUILTIN_LABS.find((l) => l.id === 'lab-3-vlans-roas')!);
    const r1 = lab.devices.find((d) => d.name === 'R1')!;
    r1.startup = ['enable', 'conf t', 'int Gi0/0', 'no shut', 'end'];
    const e = Engine.fromLab(lab);
    const r = e.ping('PC1', '10.0.20.20', { count: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toMatch(/subinterface|no route|vlan|arp timeout/);
  });

  it('eval3: OSPF missing network', () => {
    const lab = structuredClone(BUILTIN_LABS.find((l) => l.id === 'lab-6-ospf-area0')!);
    lab.devices.find((d) => d.name === 'R2')!.startup = (lab.devices.find((d) => d.name === 'R2')!.startup ?? []).filter(
      (l) => !l.startsWith('network'),
    );
    const e = Engine.fromLab(lab);
    expect(e.runOneCheck({ type: 'ospf-full', a: 'R1', b: 'R2' }).ok).toBe(false);
    e.exec('R2', 'enable');
    e.exec('R2', 'conf t');
    e.exec('R2', 'router ospf 1');
    e.exec('R2', 'network 10.0.2.0 0.0.0.255 area 0');
    e.exec('R2', 'network 10.0.12.0 0.0.0.255 area 0');
    e.convergeOspf();
    expect(e.runOneCheck({ type: 'ospf-full', a: 'R1', b: 'R2' }).ok).toBe(true);
  });

  it('eval4: wifi not associated — nmcli is the fix command', () => {
    const lab = structuredClone(BUILTIN_LABS.find((l) => l.id === 'lab-7-wifi-dhcp-ping')!);
    lab.devices.find((d) => d.name === 'PC1')!.post = [];
    const e = Engine.fromLab(lab);
    expect(e.find('PC1')?.associatedSsid).toBeFalsy();
    expect(listCommands('workstation').map((c) => c.cmd).join('\n')).toContain('nmcli wifi connect');
    e.exec('PC1', 'nmcli wifi connect CORP password netbench');
    expect(e.find('PC1')?.associatedSsid).toBe('CORP');
  });

  it('eval5: build dual-stack office — pings pass', () => {
    const e = Engine.fromLab(dualStackOfficeLab());
    const chk = e.check();
    expect(chk.ok, chk.results.map((r) => r.reason).join('; ')).toBe(true);
  });

  it('labFromSpec emits the office template for the dual-stack office sentence', () => {
    const lab = labFromSpec('Build a dual-stack office: SW, R, AP, server, 2 PCs');
    expect(lab.id).toBe(dualStackOfficeLab().id);
    expect(lab.devices.map((d) => d.name).sort()).toEqual(dualStackOfficeLab().devices.map((d) => d.name).sort());
    const chk = Engine.fromLab(lab).check();
    expect(chk.ok, chk.results.map((r) => r.reason).join('; ')).toBe(true);
  });

  it('labFromSpec caps a 50-worker office to a canvas-sized topology that still boots and pings', () => {
    const lab = labFromSpec('create a complex office of 50 workers and several departments');
    const pcs = lab.devices.filter((d) => d.kind === 'workstation');
    expect(pcs.length).toBeGreaterThanOrEqual(1);
    expect(pcs.length).toBeLessThanOrEqual(12);
    expect(lab.devices.length).toBeLessThanOrEqual(40);
    const e = Engine.fromLab(lab);
    const chk = e.check();
    expect(chk.ok, chk.results.map((r) => r.reason).join('; ')).toBe(true);
  });

  it('labFromSpec spreads a big office over several trunked switches', () => {
    const lab = labFromSpec('an office with 12 PCs, 2 servers, a router, wifi on VLAN 20 and a server on VLAN 10');
    const sws = lab.devices.filter((d) => d.kind === 'switch');
    expect(sws.length).toBeGreaterThanOrEqual(2);
    // Every switch-to-switch link is a trunk on both ends.
    for (const l of lab.links) {
      const [an, ai] = l.a.split(':');
      const [bn, bi] = l.b.split(':');
      if (sws.some((s) => s.name === an) && sws.some((s) => s.name === bn)) {
        for (const [n, i] of [[an, ai], [bn, bi]]) {
          const startup = lab.devices.find((d) => d.name === n)!.startup!.join('\n');
          expect(startup, `${n} ${i}`).toMatch(new RegExp(`int ${i.replace('/', '\\/')}\\nswitchport mode trunk`));
        }
      }
    }
    const e = Engine.fromLab(lab);
    const chk = e.check();
    expect(chk.ok, chk.results.map((r) => r.reason).join('; ')).toBe(true);
  });

  it('validateLab accepts a well-formed lab and rejects bad ports, duplicates and out-of-scope config', () => {
    const good = validateLab({
      name: 'Campus',
      devices: [
        { kind: 'workstation', name: 'PC1', x: 0, y: 0, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
        { kind: 'switch', name: 'SW1', x: 100, y: 0 },
      ],
      links: [{ a: 'PC1:eth0', b: 'SW1:Gi0/1' }],
      checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.10' }],
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.lab.id).toMatch(/^nb-campus-/);
      expect(labStartupErrors(good.lab)).toEqual([]);
    }
    expect(validateLab({ devices: [{ kind: 'switch', name: 'SW1', x: 0, y: 0 }], links: [{ a: 'SW1:Gi0/9', b: 'SW1:Gi0/1' }] }).ok).toBe(false);
    expect(validateLab({ devices: [{ kind: 'router', name: 'R1', x: 0, y: 0, startup: ['router bgp 65000'] }], links: [] }).ok).toBe(false);
    expect(validateLab({ devices: [{ kind: 'pc', name: 'X', x: 0, y: 0 }], links: [] }).ok).toBe(false);
    const dup = validateLab({ devices: [{ kind: 'switch', name: 'SW1', x: 0, y: 0 }, { kind: 'switch', name: 'sw1', x: 0, y: 0 }], links: [] });
    expect(dup.ok).toBe(false);
    const bad = validateLab({
      devices: [{ kind: 'router', name: 'R1', x: 0, y: 0, startup: ['enable', 'conf t', 'frobnicate', 'end'] }],
      links: [],
    });
    expect(bad.ok).toBe(true);
    if (bad.ok) expect(labStartupErrors(bad.lab)).toEqual([{ device: 'R1', line: 'frobnicate', error: expect.stringMatching(/Unknown command/) }]);
  });

  it('labFromSpec two PCs and a switch is not the office lab and pings', () => {
    const lab = labFromSpec('two PCs and a switch');
    expect(lab.devices.some((d) => d.kind === 'ap')).toBe(false);
    expect(lab.devices.filter((d) => d.kind === 'workstation')).toHaveLength(2);
    expect(lab.devices.filter((d) => d.kind === 'switch')).toHaveLength(1);
    const chk = Engine.fromLab(lab).check();
    expect(chk.ok, chk.results.map((r) => r.reason).join('; ')).toBe(true);
  });

  it('labFromSpec OSPF sentence includes two routers, firewall sentence includes a firewall', () => {
    const ospf = labFromSpec('two routers running OSPF area 0 with a PC on each side');
    expect(ospf.devices.filter((d) => d.kind === 'router').length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(ospf).toLowerCase()).toContain('ospf');
    const fw = labFromSpec('a firewall in front of a server and a workstation');
    expect(fw.devices.some((d) => d.kind === 'firewall')).toBe(true);
    expect(ospf.devices.map((d) => d.kind).sort().join(',')).not.toBe(fw.devices.map((d) => d.kind).sort().join(','));
  });

  it('labFromSpec refuses BGP', () => {
    expect(() => labFromSpec('Please add BGP to this lab')).toThrow(/bgp|ospf/i);
  });

  it('labFromSpec builder sentence: two VLANs, wifi 20, server 10, PC pings via router', () => {
    const spec =
      'two VLANs, one router, wifi on VLAN 20, Linux server on VLAN 10, PC must ping the server via the router';
    const lab = labFromSpec(spec);
    const kinds = lab.devices.map((d) => d.kind);
    expect(kinds.filter((k) => k === 'workstation').length, JSON.stringify(lab.devices.map((d) => d.name))).toBeGreaterThanOrEqual(1);
    expect(kinds).toContain('server');
    expect(kinds).toContain('router');
    expect(kinds).toContain('ap');
    const srv = lab.devices.find((d) => d.kind === 'server')!;
    expect(srv.startup?.join('\n')).toMatch(/10\.0\.10\./);
    expect(srv.startup?.join('\n')).not.toMatch(/10\.0\.20\./);
    const ap = lab.devices.find((d) => d.kind === 'ap')!;
    expect(ap.startup?.join('\n')).toMatch(/vlan 20/);
    const r1 = lab.devices.find((d) => d.kind === 'router')!;
    expect(r1.startup?.join('\n')).toMatch(/dot1Q 10/);
    expect(r1.startup?.join('\n')).toMatch(/dot1Q 20/);
    const pings = lab.checks.filter((c) => c.type === 'ping');
    expect(pings.length, JSON.stringify(lab.checks)).toBeGreaterThanOrEqual(1);
    expect(pings.some((c) => c.type === 'ping' && c.dst.includes('10.0.10.'))).toBe(true);
    const chk = Engine.fromLab(lab).check();
    expect(chk.ok, chk.results.map((r) => r.reason).join('; ')).toBe(true);
  });

  it('eval6: BGP is not in the palette / command list', () => {
    const cmds = [
      ...listCommands('router'),
      ...listCommands('switch'),
      ...listCommands('workstation'),
    ]
      .map((c) => c.cmd.toLowerCase())
      .join('\n');
    expect(cmds).not.toContain('bgp');
    expect(cmds).toContain('ospf');
  });
});

describe('patch schema', () => {
  it('rejects unknown device types', () => {
    const r = validatePatch({ addDevices: [{ type: 'nexus', name: 'N1' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown device type/);
  });

  it('accepts a small valid patch', () => {
    const r = validatePatch({
      addDevices: [{ type: 'router', name: 'R9', x: 1, y: 2 }],
      addLinks: [{ a: 'R9:Gi0/0', b: 'SW1:Gi0/8' }],
      configs: [{ device: 'R9', commands: ['enable', 'conf t'] }],
    });
    expect(r.ok).toBe(true);
  });

  it('accepts cable type on addLinks and rejects unknown cable', () => {
    const ok = validatePatch({ addLinks: [{ a: 'R1:Gi0/0', b: 'SW1:Gi0/1', cable: 'fiber' }] });
    expect(ok.ok).toBe(true);
    const bad = validatePatch({ addLinks: [{ a: 'R1:Gi0/0', b: 'SW1:Gi0/1', cable: 'coax' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/unknown cable/);
  });
});

describe('cables and used ports', () => {
  type IfaceView = {
    name: string;
    operUp: boolean;
    status: string;
    peer: { device: string; iface: string; linkId: string; cable: string } | null;
  };
  type StateView = { devices: { name: string; kind: string; ifaces: IfaceView[] }[]; links: { cable?: string }[] };

  function iface(st: StateView, dev: string, name: string) {
    const d = st.devices.find((x) => x.name === dev);
    const i = d?.ifaces.find((x) => x.name === name);
    if (!i) throw new Error(`missing ${dev} ${name}`);
    return i;
  }

  it('reports used switch and router ports from getState', () => {
    const e = Engine.fromLab({
      schemaVersion: 1,
      id: 'ports',
      name: 'ports',
      devices: [
        { kind: 'workstation', name: 'PC1', x: 0, y: 0, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
        { kind: 'switch', name: 'SW1', x: 80, y: 0, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'] },
        {
          kind: 'router',
          name: 'R1',
          x: 160,
          y: 0,
          startup: ['enable', 'conf t', 'int Gi0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shut', 'end'],
        },
      ],
      links: [
        { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
        { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
      ],
      checks: [],
    });
    const st = e.getState() as unknown as StateView;
    const sw1 = iface(st, 'SW1', 'Gi0/1');
    expect(sw1.operUp).toBe(true);
    expect(sw1.status).toBe('Up');
    expect(sw1.peer).toMatchObject({ device: 'PC1', iface: 'eth0', cable: 'ethernet' });
    const sw2 = iface(st, 'SW1', 'Gi0/2');
    expect(sw2.peer).toMatchObject({ device: 'R1', iface: 'Gi0/0' });
    expect(iface(st, 'SW1', 'Gi0/3').peer).toBeNull();
    expect(iface(st, 'SW1', 'Gi0/3').status).toBe('Disabled');
    const r0 = iface(st, 'R1', 'Gi0/0');
    expect(r0.peer).toMatchObject({ device: 'SW1', iface: 'Gi0/2' });
    expect(iface(st, 'R1', 'Gi0/1').peer).toBeNull();
  });

  it('cabling a new PC brings both Ethernet ports up', () => {
    const e = Engine.fromLab(twoPcSwitch());
    e.addDevice('workstation', 'PC3', 40, 40);
    const pc3 = e.dev('PC3');
    expect(pc3.ifaces[0].adminUp).toBe(true);
    expect(pc3.ifaces[0].name).toBe('eth0');
    e.addLink('PC3:eth0', 'SW1:Gi0/3');
    const st = e.getState() as unknown as StateView;
    expect(iface(st, 'PC3', 'eth0').status).toBe('Up');
    expect(iface(st, 'SW1', 'Gi0/3').status).toBe('Up');
    expect(iface(st, 'PC3', 'wlan0').status).toBe('Unplugged');
  });

  it('rejects a second cable on an occupied port', () => {
    const e = Engine.fromLab(twoPcSwitch());
    expect(() => e.addLink('PC1:eth0', 'SW1:Gi0/3')).toThrow(/already cabled/);
  });

  it('ethernet auto-MDIX links PC to PC; straight-through does not', () => {
    const e = Engine.fromLab({
      schemaVersion: 1,
      id: 'pcpc',
      name: 'pcpc',
      devices: [
        { kind: 'workstation', name: 'PC1', x: 0, y: 0, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
        { kind: 'workstation', name: 'PC2', x: 1, y: 0, startup: ['ip addr add 10.0.0.20/24 dev eth0', 'ip link set eth0 up'] },
      ],
      links: [],
      checks: [],
    });
    e.addLink('PC1:eth0', 'PC2:eth0', true, 'ethernet');
    expect(e.operUp(e.dev('PC1'), e.dev('PC1').ifaces[0])).toBe(true);
    e.removeLink(e.links[0].id);
    e.addLink('PC1:eth0', 'PC2:eth0', true, 'straight');
    expect(e.operUp(e.dev('PC1'), e.dev('PC1').ifaces[0])).toBe(false);
    const st = e.getState() as unknown as StateView;
    expect(iface(st, 'PC1', 'eth0').status).toBe('Wrong cable');
  });

  it('crossover links two switches; straight-through links PC to switch', () => {
    const e = Engine.fromLab({
      schemaVersion: 1,
      id: 'cables',
      name: 'cables',
      devices: [
        { kind: 'switch', name: 'SW1', x: 0, y: 0, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'] },
        { kind: 'switch', name: 'SW2', x: 1, y: 0, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'end'] },
        { kind: 'workstation', name: 'PC1', x: 2, y: 0, startup: ['ip link set eth0 up'] },
      ],
      links: [],
      checks: [],
    });
    e.addLink('SW1:Gi0/1', 'SW2:Gi0/1', true, 'crossover');
    expect(e.operUp(e.dev('SW1'), e.dev('SW1').ifaces[0])).toBe(true);
    e.addLink('PC1:eth0', 'SW1:Gi0/2', true, 'straight');
    expect(e.operUp(e.dev('PC1'), e.dev('PC1').ifaces[0])).toBe(true);
    e.removeLink(e.links[0].id);
    e.addLink('SW1:Gi0/1', 'SW2:Gi0/1', true, 'straight');
    expect(e.operUp(e.dev('SW1'), e.dev('SW1').ifaces[0])).toBe(false);
  });

  it('fiber is refused on a PC and works between switch and router', () => {
    const e = Engine.fromLab({
      schemaVersion: 1,
      id: 'fiber',
      name: 'fiber',
      devices: [
        { kind: 'workstation', name: 'PC1', x: 0, y: 0 },
        { kind: 'switch', name: 'SW1', x: 1, y: 0 },
        { kind: 'router', name: 'R1', x: 2, y: 0 },
      ],
      links: [],
      checks: [],
    });
    expect(() => e.addLink('PC1:eth0', 'SW1:Gi0/1', true, 'fiber')).toThrow(/no SFP/);
    e.addLink('R1:Gi0/0', 'SW1:Gi0/1', true, 'fiber');
    const st = e.getState() as unknown as StateView;
    expect(iface(st, 'SW1', 'Gi0/1').peer).toMatchObject({ device: 'R1', iface: 'Gi0/0', cable: 'fiber' });
    expect(iface(st, 'SW1', 'Gi0/1').operUp).toBe(true);
  });
});

describe('get_path drop reason matches inspector', () => {
  it('uses the same last drop reason', () => {
    const e = Engine.fromLab(twoPcSwitch());
    e.exec('PC2', 'ip link set eth0 down');
    const path = e.getPath('PC1', '10.0.0.20', 'icmp', 'v4');
    expect(path.ok).toBe(false);
    const drop = [...path.events].reverse().find((x) => x.drop);
    expect(drop?.reason).toBe(path.reason);
  });
});

describe('route and address removal', () => {
  it('ip route del / replace fix a wrong default gateway on a host', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-2-missing-gateway')!);
    // Wrong gateway: add refuses a second default, replace swaps it, del removes it.
    expect(e.exec('PC1', 'ip route add default via 10.0.0.9').error).toBe(true);
    expect(e.exec('PC1', 'ip route replace default via 10.0.0.9').error).toBeFalsy();
    expect(e.ping('PC1', '10.0.1.20', { count: 1 }).ok).toBe(false);
    expect(e.exec('PC1', 'ip route replace default via 10.0.0.1').error).toBeFalsy();
    expect(e.ping('PC1', '10.0.1.20', { count: 1 }).ok).toBe(true);
    expect(e.exec('PC1', 'ip route del default').error).toBeFalsy();
    expect(e.dev('PC1').defaultGw4).toBeUndefined();
    expect(e.exec('PC1', 'ip route del default').error).toBe(true);
    const r = e.ping('PC1', '10.0.1.20', { count: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason.toLowerCase()).toMatch(/no route|gateway/);
    expect(e.exec('PC1', 'ip route add default via 10.0.0.1').error).toBeFalsy();
    expect(e.ping('PC1', '10.0.1.20', { count: 1 }).ok).toBe(true);
    expect(e.runningConfig(e.dev('PC1'))).toContain('ip route 0.0.0.0 0.0.0.0 10.0.0.1');
  });

  it('ip addr del removes the address and the routes that depended on it', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-2-missing-gateway')!);
    expect(e.exec('PC1', 'ip addr del 10.0.0.99/24 dev eth0').error).toBe(true);
    expect(e.exec('PC1', 'ip addr del 10.0.0.10/24 dev eth0').error).toBeFalsy();
    const pc = e.dev('PC1');
    expect(pc.ifaces[0].ipv4).toBeUndefined();
    expect(pc.routesV4.some((r) => r.prefix === 0)).toBe(false);
    // Re-address with a different mask, then a fresh gateway: back to working.
    e.exec('PC1', 'ip addr add 10.0.0.10/24 dev eth0');
    expect(e.exec('PC1', 'ip route add default via 10.0.0.1').error).toBeFalsy();
    expect(e.ping('PC1', '10.0.1.20', { count: 1 }).ok).toBe(true);
  });

  it('router: no ip route removes a static route; no ip address clears an interface', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-8-firewall-ssh')!);
    e.exec('R1', 'enable');
    e.exec('R1', 'conf t');
    expect(e.exec('R1', 'no ip route 10.0.30.0 255.255.255.0 10.0.99.2').error).toBeFalsy();
    expect(e.dev('R1').routesV4.some((r) => r.dest === '10.0.30.0' && r.proto === 'static')).toBe(false);
    expect(e.exec('R1', 'no ip route 10.0.30.0 255.255.255.0 10.0.99.2').error).toBe(true);
    expect(e.getPath('JUMP', '10.0.30.10', 'ssh', 'v4').ok).toBe(false);
    e.exec('R1', 'ip route 10.0.30.0 255.255.255.0 10.0.99.2');
    e.exec('R1', 'end');
    expect(e.getPath('JUMP', '10.0.30.10', 'ssh', 'v4').ok).toBe(true);
    e.exec('R1', 'conf t');
    e.exec('R1', 'int Gi0/1');
    expect(e.exec('R1', 'no ip address').error).toBeFalsy();
    expect(e.dev('R1').ifaces.find((i) => i.name === 'Gi0/1')?.ipv4).toBeUndefined();
  });

  it('AP and WLC accept int/shutdown per interface', () => {
    const e = Engine.fromLab(BUILTIN_LABS.find((l) => l.id === 'lab-7-wifi-dhcp-ping')!);
    const ap = e.dev('AP1');
    e.exec('AP1', 'enable');
    e.exec('AP1', 'conf t');
    expect(e.exec('AP1', 'int wlan0').error).toBeFalsy();
    expect(e.exec('AP1', 'shutdown').error).toBeFalsy();
    expect(ap.ifaces.find((i) => i.name === 'wlan0')?.adminUp).toBe(false);
    expect(ap.ifaces.find((i) => i.name === 'Gi0/1')?.adminUp).toBe(true);
    expect(e.exec('AP1', 'no shutdown').error).toBeFalsy();
    expect(ap.ifaces.find((i) => i.name === 'wlan0')?.adminUp).toBe(true);
    // Every startup line of every builtin lab must be a command the device understands.
    for (const lab of BUILTIN_LABS) {
      const fresh = Engine.fromLab({ ...lab, devices: lab.devices.map((d) => ({ ...d, startup: [], post: [] })) });
      for (const d of lab.devices) {
        for (const line of d.startup ?? []) {
          const r = fresh.exec(fresh.dev(d.name).id, line);
          expect(r.error, `${lab.id} ${d.name}: ${line} -> ${r.output}`).toBeFalsy();
        }
      }
    }
  });
});
