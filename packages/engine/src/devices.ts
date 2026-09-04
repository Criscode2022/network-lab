import { allocMac, linkLocalFromMac } from './ip.ts';
import {
  HOST_KINDS,
  isManagedSwitch,
  KIND_PORTS,
  SWITCH_PROFILES,
  switchProfileOf,
  type Device,
  type DeviceKind,
  type Iface,
  type SwitchProfile,
} from './types.ts';

export function newIface(name: string, kind: DeviceKind): Iface {
  const mac = allocMac();
  const linux = HOST_KINDS.includes(kind) || kind === 'cloud' || kind === 'firewall';
  const l2 = kind === 'switch' || (kind === 'ap' && name !== 'wlan0');
  const radio = name === 'wlan0';
  const ipv6 = linux || kind === 'router' || kind === 'ap' || kind === 'wlc'
    ? [{ ip: linkLocalFromMac(mac), prefix: 64 }]
    : [];
  const zone =
    kind === 'firewall'
      ? name === 'eth0'
        ? 'lan'
        : name === 'eth1'
          ? 'wan'
          : name === 'eth2'
            ? 'wifi'
            : 'dmz'
      : undefined;
  return {
    name,
    mac,
    adminUp: linux,
    ipv6,
    mode: l2 || radio ? 'access' : 'routed',
    accessVlan: 1,
    nativeVlan: 1,
    allowedVlans: 'all',
    isRadio: radio,
    zone,
  };
}

export function createDevice(
  kind: DeviceKind,
  name: string,
  x: number,
  y: number,
  id?: string,
  switchProfile?: SwitchProfile,
): Device {
  const ifaces = KIND_PORTS[kind].map((n) => newIface(n, kind));
  const profile = kind === 'switch' ? (switchProfile ?? 'managed-l2') : undefined;
  if (profile === 'unmanaged') {
    for (const iface of ifaces) iface.adminUp = true;
  }
  if (kind === 'cloud') {
    const eth0 = ifaces[0];
    eth0.ipv4 = { ip: '203.0.113.1', prefix: 24 };
    eth0.adminUp = true;
  }
  const forwarding = kind === 'router' || kind === 'firewall' || kind === 'cloud';
  return {
    id: id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    kind,
    ...(profile ? { switchProfile: profile } : {}),
    name,
    hostname: name,
    x,
    y,
    ifaces,
    routesV4: [],
    routesV6: [],
    arp: [],
    ndp: [],
    macTable: [],
    vlans: kind === 'switch' ? [1] : [],
    cli: { level: HOST_KINDS.includes(kind) || kind === 'firewall' || kind === 'cloud' ? 'priv' : 'user' },
    forwarding,
    ipRouting: false,
    sshEnabled: kind === 'server' || kind === 'workstation',
    sshUser: 'root',
    hostsFile: {},
    dnsServers: [],
    ospf: {
      enabled: false,
      process: 1,
      routerId: '',
      networks: [],
      neighbors: [],
      lsdb: [],
    },
    dhcpPools: [],
    dhcpBindings: [],
    dhcpOffered: 0,
    dhcpExcluded: [],
    acls: {},
    fwRules: [
      { action: 'allow', proto: 'any', family: 'any' },
    ],
    fwPolicy: kind === 'firewall' ? 'drop' : 'allow',
    masqueradeZones: [],
    conntrack: [],
    wifi: [],
    wlans: [],
    startupLines: [],
    switchProfileSnapshots: kind === 'switch' ? {} : undefined,
    blockedPorts: [],
    dnsRecords: kind === 'cloud' ? { 'dns.google': { a: '8.8.8.8', aaaa: '2001:4860:4860::8888' } } : {},
    sshListen: kind === 'server',
    shutdownIfaces: new Set(),
  };
}

export function findIface(dev: Device, name: string): Iface | undefined {
  const n = name.toLowerCase();
  return dev.ifaces.find((i) => i.name.toLowerCase() === n);
}

export function ensureSvi(dev: Device, vlan: number): Iface {
  if (!isManagedSwitch(dev)) throw new Error(`${dev.name} is unmanaged and has no VLAN interfaces`);
  const name = `Vlan${vlan}`;
  let iface = findIface(dev, name);
  if (!iface) {
    iface = newIface(name, 'switch');
    iface.name = name;
    iface.vlanId = vlan;
    iface.mode = 'routed';
    iface.adminUp = false;
    if (dev.switchProfile === 'multilayer') iface.ipv6.push({ ip: linkLocalFromMac(iface.mac), prefix: 64 });
    dev.ifaces.push(iface);
  }
  if (!dev.vlans.includes(vlan)) dev.vlans.push(vlan);
  return iface;
}

export function ensureSubif(dev: Device, parent: string, vlan: number): Iface {
  const name = `${parent}.${vlan}`;
  let iface = findIface(dev, name);
  if (!iface) {
    const p = findIface(dev, parent);
    iface = newIface(name, dev.kind);
    iface.name = name;
    iface.parent = parent;
    iface.encapVlan = vlan;
    iface.vlanId = vlan;
    iface.mode = 'routed';
    iface.adminUp = p?.adminUp ?? false;
    iface.mac = p?.mac ?? iface.mac;
    dev.ifaces.push(iface);
  }
  return iface;
}

export function physicalIfaces(dev: Device): Iface[] {
  return dev.ifaces.filter((i) => !i.parent && !i.name.toLowerCase().startsWith('vlan'));
}

function isSvi(iface: Iface): boolean {
  return iface.vlanId !== undefined || iface.name.toLowerCase().startsWith('vlan');
}

function stripLayer3(dev: Device): void {
  dev.forwarding = false;
  dev.ipRouting = false;
  dev.routesV4 = [];
  dev.routesV6 = [];
  dev.dhcpPools = [];
  dev.dhcpBindings = [];
  dev.dhcpOffered = 0;
  dev.dhcpExcluded = [];
  dev.defaultGw4 = undefined;
  dev.defaultGw6 = undefined;
}

function stripToUnmanaged(dev: Device): void {
  dev.ifaces = physicalIfaces(dev);
  for (const iface of dev.ifaces) {
    iface.adminUp = true;
    iface.mode = 'access';
    iface.accessVlan = 1;
    iface.nativeVlan = 1;
    iface.allowedVlans = 'all';
    iface.ipv4 = undefined;
    iface.ipv6 = [];
    iface.helperAddress = undefined;
    iface.vlanId = undefined;
    iface.encapVlan = undefined;
    iface.parent = undefined;
  }
  dev.vlans = [1];
  dev.macTable = [];
  dev.arp = [];
  dev.ndp = [];
  stripLayer3(dev);
}

function stripMultilayerOnly(dev: Device): void {
  for (const iface of dev.ifaces) {
    if (iface.mode === 'routed' && !isSvi(iface)) {
      iface.mode = 'access';
      iface.accessVlan = 1;
      iface.ipv4 = undefined;
      iface.ipv6 = [];
    }
    iface.helperAddress = undefined;
  }
  stripLayer3(dev);
}

/** Change a live switch's capability tier. Physical cables stay; features the new profile cannot have are removed. */
export function applySwitchProfile(dev: Device, profile: SwitchProfile): void {
  if (dev.kind !== 'switch') throw new Error(`${dev.name} is not a switch`);
  if (!SWITCH_PROFILES.includes(profile)) throw new Error(`unknown switchProfile ${profile}`);
  const prev = switchProfileOf(dev);
  if (prev === profile) return;
  if (profile === 'unmanaged') {
    stripToUnmanaged(dev);
  } else {
    if (profile === 'managed-l2') stripMultilayerOnly(dev);
    else {
      for (const iface of dev.ifaces) {
        if (!isSvi(iface)) continue;
        if (!iface.ipv6.some((v) => v.ip.toLowerCase().startsWith('fe80'))) {
          iface.ipv6.push({ ip: linkLocalFromMac(iface.mac), prefix: 64 });
        }
      }
    }
  }
  dev.switchProfile = profile;
  dev.cli = { level: 'user' };
  dev.startupLines = [];
}
