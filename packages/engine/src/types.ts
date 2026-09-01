export const DEVICE_KINDS = [
  'workstation',
  'server',
  'switch',
  'router',
  'firewall',
  'ap',
  'wlc',
  'cloud',
] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

export type Family = 'v4' | 'v6';

export interface Ipv4Addr {
  ip: string;
  prefix: number;
}

export interface Ipv6Addr {
  ip: string;
  prefix: number;
  slaac?: boolean;
}

export interface Iface {
  name: string;
  mac: string;
  adminUp: boolean;
  description?: string;
  ipv4?: Ipv4Addr;
  ipv6: Ipv6Addr[];
  mode: 'access' | 'trunk' | 'routed';
  accessVlan: number;
  nativeVlan: number;
  allowedVlans: number[] | 'all';
  parent?: string;
  vlanId?: number;
  isRadio?: boolean;
  nat?: 'inside' | 'outside';
  zone?: string;
  ospfEnabled?: boolean;
  raSuppress?: boolean;
  raPrefix?: { cidr: string; prefix: number } | null;
  dhcpClient?: boolean;
  /** Subinterface encapsulation. */
  encapVlan?: number;
}

export interface RouteV4 {
  dest: string;
  prefix: number;
  nexthop?: string;
  iface?: string;
  proto: 'connected' | 'static' | 'ospf' | 'dhcp';
  ad: number;
  metric?: number;
}

export interface RouteV6 {
  dest: string;
  prefix: number;
  nexthop?: string;
  iface?: string;
  proto: 'connected' | 'static' | 'ra' | 'ospf';
  ad: number;
}

export interface ArpEntry {
  ip: string;
  mac: string;
  iface: string;
}

export interface NdpEntry {
  ip: string;
  mac: string;
  iface: string;
}

export interface MacEntry {
  mac: string;
  iface: string;
  vlan: number;
}

export type CliLevel = 'user' | 'priv' | 'config' | 'if' | 'router' | 'dhcp' | 'acl' | 'wlan' | 'line';

export interface CliState {
  level: CliLevel;
  iface?: string;
  ospfProcess?: number;
  dhcpPool?: string;
  aclName?: string;
  wlanName?: string;
  sshPeer?: string;
}

export interface OspfNeighbor {
  routerId: string;
  state: 'Down' | 'Init' | '2WAY' | 'EXSTART' | 'EXCHANGE' | 'LOADING' | 'FULL';
  iface: string;
  peerIp: string;
  area: string;
}

export interface OspfLsa {
  type: 1 | 2;
  id: string;
  adv: string;
  seq: number;
  prefixes: { dest: string; prefix: number; metric: number; nexthopHint?: string }[];
}

export interface DhcpPool {
  name: string;
  network?: string;
  prefix?: number;
  gateway?: string;
  dns?: string;
  start?: number;
  end?: number;
}

export interface DhcpBinding {
  mac: string;
  ip: string;
  iface: string;
}

export interface AclRule {
  action: 'permit' | 'deny';
  proto: 'ip' | 'ipv6' | 'tcp' | 'udp' | 'icmp' | 'any';
  src: string;
  dst: string;
  dport?: number;
  sport?: number;
}

export interface FwRule {
  action: 'allow' | 'deny';
  proto: 'any' | 'tcp' | 'udp' | 'icmp' | 'icmp6';
  srcZone?: string;
  dstZone?: string;
  src?: string;
  dst?: string;
  dport?: number;
  family?: Family | 'any';
}

export interface Conntrack {
  family: Family;
  proto: string;
  src: string;
  dst: string;
  sport?: number;
  dport?: number;
  snatSrc?: string;
  origSrc: string;
}

export interface WifiSsid {
  ssid: string;
  vlan: number;
  psk?: string;
  open?: boolean;
  channel: number;
}

export interface Wlan {
  ssid: string;
  vlan: number;
  psk?: string;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  name: string;
  hostname: string;
  x: number;
  y: number;
  ifaces: Iface[];
  routesV4: RouteV4[];
  routesV6: RouteV6[];
  arp: ArpEntry[];
  ndp: NdpEntry[];
  macTable: MacEntry[];
  vlans: number[];
  cli: CliState;
  forwarding: boolean;
  sshEnabled: boolean;
  sshUser: string;
  hostsFile: Record<string, string>;
  dnsServers: string[];
  ospf: {
    enabled: boolean;
    process: number;
    routerId: string;
    networks: { network: string; wildcard: string; area: string }[];
    neighbors: OspfNeighbor[];
    lsdb: OspfLsa[];
  };
  dhcpPools: DhcpPool[];
  dhcpBindings: DhcpBinding[];
  dhcpOffered: number;
  acls: Record<string, AclRule[]>;
  natAcl?: string;
  natOverloadIface?: string;
  fwRules: FwRule[];
  fwPolicy: 'allow' | 'drop';
  masqueradeZones: string[];
  conntrack: Conntrack[];
  wifi: WifiSsid[];
  capwapController?: string;
  joinedWlc?: string;
  wlans: Wlan[];
  associatedSsid?: string;
  associatedAp?: string;
  defaultGw4?: string;
  defaultGw6?: string;
  startupLines: string[];
  blockedPorts: string[];
  loopWarning?: string;
  dnsRecords: Record<string, { a?: string; aaaa?: string }>;
  sshListen: boolean;
  shutdownIfaces: Set<string>;
}

/** Physical wired cable. `ethernet` is auto-MDIX (always links). Radio links omit this. */
export type CableMedia = 'ethernet' | 'straight' | 'crossover' | 'fiber';

export interface Link {
  id: string;
  a: { deviceId: string; iface: string };
  b: { deviceId: string; iface: string };
  kind: 'copper' | 'radio';
  cable?: CableMedia;
  ssid?: string;
}

export type L3Proto = 'icmp' | 'icmp6' | 'udp' | 'tcp' | 'ospf' | 'dhcp' | 'dhcp6' | 'dns' | 'arp' | 'ndp' | 'ra' | 'ssh';

export interface L3Packet {
  id: string;
  family: Family;
  src: string;
  dst: string;
  proto: L3Proto;
  ttl: number;
  sport?: number;
  dport?: number;
  icmpType?: 'echo-request' | 'echo-reply' | 'time-exceeded' | 'dest-unreach' | 'ns' | 'na' | 'rs' | 'ra';
  icmpSeq?: number;
  icmpId?: number;
  payload?: Record<string, unknown>;
}

export interface ArpPdu {
  op: 'request' | 'reply';
  sha: string;
  spa: string;
  tha: string;
  tpa: string;
}

export interface Frame {
  id: string;
  srcMac: string;
  dstMac: string;
  vlan?: number;
  ssid?: string;
  ethertype: 'arp' | 'ipv4' | 'ipv6';
  arp?: ArpPdu;
  l3?: L3Packet;
}

export interface PacketEvent {
  id: string;
  t: number;
  from: { device: string; iface: string };
  to?: { device: string; iface: string };
  srcMac: string;
  dstMac: string;
  vlan?: number;
  ssid?: string;
  srcIp?: string;
  dstIp?: string;
  proto: string;
  ttl?: number;
  reason: string;
  drop?: boolean;
  simulated?: boolean;
}

export interface CheckPing {
  type: 'ping';
  src: string;
  dst: string;
  family?: Family;
}

export interface CheckSsh {
  type: 'ssh';
  src: string;
  dst: string;
  expect: 'allow' | 'deny';
}

export interface CheckAssoc {
  type: 'wifi-associated';
  client: string;
}

export interface CheckDhcp {
  type: 'dhcp-bound';
  device: string;
}

export interface CheckOspf {
  type: 'ospf-full';
  a: string;
  b: string;
}

export type LabCheck = CheckPing | CheckSsh | CheckAssoc | CheckDhcp | CheckOspf;

export interface LabJson {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  goal?: string;
  differsNote?: string;
  devices: {
    id?: string;
    kind: DeviceKind;
    name: string;
    x: number;
    y: number;
    hostname?: string;
    startup?: string[];
    /** Commands applied after every device has run startup (Wi-Fi associate, dhclient). */
    post?: string[];
  }[];
  links: { a: string; b: string; cable?: CableMedia }[];
  checks: LabCheck[];
}

export interface PathHop {
  device: string;
  iface: string;
  reason: string;
}

export interface PathResult {
  ok: boolean;
  hops: PathHop[];
  reason: string;
  events: PacketEvent[];
  drop?: PacketEvent;
}

export interface PingResult {
  ok: boolean;
  output: string;
  reason: string;
  events: PacketEvent[];
  rttMs: number[];
}

export interface CliResult {
  output: string;
  prompt: string;
  error?: boolean;
  events: PacketEvent[];
}

export interface CheckItemResult {
  check: LabCheck;
  ok: boolean;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  results: CheckItemResult[];
}

export interface LabPatch {
  addDevices?: { type: DeviceKind; name: string; x?: number; y?: number }[];
  removeDeviceIds?: string[];
  addLinks?: { a: string; b: string; cable?: CableMedia }[];
  removeLinks?: string[];
  configs?: { device: string; commands: string[] }[];
}

export const KIND_PORTS: Record<DeviceKind, string[]> = {
  workstation: ['eth0', 'wlan0'],
  server: ['eth0', 'eth1'],
  switch: ['Gi0/1', 'Gi0/2', 'Gi0/3', 'Gi0/4', 'Gi0/5', 'Gi0/6', 'Gi0/7', 'Gi0/8'],
  router: ['Gi0/0', 'Gi0/1', 'Gi0/2', 'Gi0/3'],
  firewall: ['eth0', 'eth1', 'eth2', 'eth3'],
  ap: ['Gi0/1', 'wlan0'],
  wlc: ['Gi0/1'],
  cloud: ['eth0'],
};

export const L3_KINDS: DeviceKind[] = ['workstation', 'server', 'router', 'firewall', 'cloud', 'ap', 'wlc'];
export const HOST_KINDS: DeviceKind[] = ['workstation', 'server'];
export const CISCO_KINDS: DeviceKind[] = ['switch', 'router', 'ap', 'wlc'];
