import { allocMac, linkLocalFromMac } from './ip.ts';
import {
  HOST_KINDS,
  KIND_PORTS,
  type Device,
  type DeviceKind,
  type Iface,
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
    adminUp: linux && !radio,
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
): Device {
  const ifaces = KIND_PORTS[kind].map((n) => newIface(n, kind));
  if (kind === 'cloud') {
    const eth0 = ifaces[0];
    eth0.ipv4 = { ip: '203.0.113.1', prefix: 24 };
    eth0.adminUp = true;
  }
  const forwarding = kind === 'router' || kind === 'firewall' || kind === 'cloud';
  return {
    id: id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    kind,
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
  const name = `Vlan${vlan}`;
  let iface = findIface(dev, name);
  if (!iface) {
    iface = newIface(name, 'switch');
    iface.name = name;
    iface.vlanId = vlan;
    iface.mode = 'routed';
    iface.adminUp = false;
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
