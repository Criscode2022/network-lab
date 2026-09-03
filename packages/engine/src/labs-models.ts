/**
 * Model labs: reference topologies that pass Check exactly as shipped. Read the running-configs, copy from them,
 * break one thing and repair it. Several are derived from an exercise by baking its solution into the startup
 * config (`modelFromExercise`), so the model and its exercise can never drift apart.
 */
import { dualStackOfficeLab } from './build.ts';
import {
  EX_CAMPUS_SERVER_UNREACHABLE,
  EX_NAT,
  EX_OSPF_TRIANGLE,
  EX_STATIC_ROUTES,
  EX_TRUNK_ALLOWED_VLAN,
  EX_WLC,
} from './labs-exercises.ts';
import { SW_TWO_PORTS, access, cisco, linuxHost, modelFromExercise, subif, swPorts, trunk } from './labs-shared.ts';
import type { LabJson } from './types.ts';

// ---------------------------------------------------------------------------------------------------------
// Beginner
// ---------------------------------------------------------------------------------------------------------

export const MODEL_FIRST_PING: LabJson = {
  schemaVersion: 1,
  id: 'lab-1-first-ipv4-ping',
  kind: 'model',
  level: 'beginner',
  topics: ['ipv4', 'switching', 'arp'],
  name: 'First IPv4 ping',
  goal: 'Two PCs on one switch, same /24. Watch ARP resolve the MAC, then ICMP echo and reply. Everything is configured — press Check, then read each device.',
  description: 'The smallest working network: two Linux workstations, an L2 switch, one subnet. Try: break it (ip addr del on PC2) and repair it.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 200, startup: linuxHost('10.0.0.10/24') },
    { kind: 'workstation', name: 'PC2', x: 520, y: 200, startup: linuxHost('10.0.0.20/24') },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: SW_TWO_PORTS },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
};

export const MODEL_TWO_SUBNETS: LabJson = {
  schemaVersion: 1,
  id: 'lab-2-two-subnets-router',
  kind: 'model',
  level: 'beginner',
  topics: ['ipv4', 'routing', 'default-gateway'],
  name: 'Two subnets through a router',
  goal: 'PC1 (10.0.0.10/24) pings PC2 (10.0.1.20/24) via R1. Each PC has a default gateway on its own subnet; R1 has one address per interface. Trace the ping and watch the TTL drop by one.',
  description: 'The reference for “why do I need a default gateway”. Exercises on this topology: wrong default gateway.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 220, startup: linuxHost('10.0.0.10/24', '10.0.0.1') },
    { kind: 'workstation', name: 'PC2', x: 560, y: 220, startup: linuxHost('10.0.1.20/24', '10.0.1.1') },
    { kind: 'switch', name: 'SW1', x: 200, y: 80, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW2', x: 440, y: 80, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 40,
      startup: cisco('int Gi0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shut', 'int Gi0/1', 'ip address 10.0.1.1 255.255.255.0', 'no shut'),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'PC2:eth0', b: 'SW2:Gi0/1' },
    { a: 'R1:Gi0/1', b: 'SW2:Gi0/2' },
  ],
  checks: [
    { type: 'ping', src: 'PC1', dst: '10.0.1.20', family: 'v4' },
    { type: 'ping', src: 'PC2', dst: '10.0.0.10', family: 'v4' },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Intermediate
// ---------------------------------------------------------------------------------------------------------

export const MODEL_STATIC_ROUTES: LabJson = modelFromExercise(EX_STATIC_ROUTES, {
  id: 'model-static-routes',
  name: 'Two routers, static routes',
  goal: 'PC1 (10.1.1.10) and PC2 (10.2.2.10) reach each other across a /30 link. Each router has one static route for the network it does not own. Read show ip route on both routers.',
  description: 'The reference for static routing: connected networks appear on their own, everything else needs a route — in both directions.',
  level: 'intermediate',
});

export const MODEL_ROAS: LabJson = {
  schemaVersion: 1,
  id: 'lab-3-vlans-roas',
  kind: 'model',
  level: 'intermediate',
  topics: ['vlan', 'trunk', 'router-on-a-stick'],
  name: 'VLANs + router-on-a-stick',
  goal: 'PC1 in VLAN 10 pings PC2 in VLAN 20 through R1 sub-interfaces Gi0/0.10 and Gi0/0.20. Access ports, one 802.1Q trunk, one router.',
  description: 'The reference for inter-VLAN routing. Exercises on this topology: PC in the wrong VLAN, sub-interface with the wrong encapsulation.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 320, startup: linuxHost('10.0.10.10/24', '10.0.10.1') },
    { kind: 'workstation', name: 'PC2', x: 560, y: 320, startup: linuxHost('10.0.20.20/24', '10.0.20.1') },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 180,
      startup: cisco('vlan 10', 'vlan 20', ...access('Gi0/1', 10), ...access('Gi0/2', 20), ...trunk('Gi0/8', [10, 20])),
    },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 40,
      startup: cisco('int Gi0/0', 'no shut', ...subif('Gi0/0', 10, '10.0.10.1'), ...subif('Gi0/0', 20, '10.0.20.1')),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/8' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.20.20', family: 'v4' }],
};

export const MODEL_TWO_SWITCHES_TRUNK: LabJson = modelFromExercise(EX_TRUNK_ALLOWED_VLAN, {
  id: 'model-two-switches-trunk',
  name: 'Two switches, one trunk, two VLANs',
  goal: 'Four PCs in two VLANs spread over two switches. Same-VLAN traffic crosses the SW1–SW2 trunk tagged; VLAN 10 and VLAN 20 never see each other (there is no router).',
  description: 'The reference for 802.1Q trunking without routing. Check show interfaces trunk on both switches: the allowed lists match.',
  level: 'intermediate',
});

export const MODEL_DHCP: LabJson = {
  schemaVersion: 1,
  id: 'lab-4-dhcpv4',
  kind: 'model',
  level: 'intermediate',
  topics: ['dhcp', 'ipv4'],
  name: 'DHCPv4 from the router',
  goal: 'PC1 boots without an address, runs dhclient and gets 192.168.1.x, a mask, a gateway and a DNS server from R1’s pool. Then it pings 192.168.1.1.',
  description: 'The reference for DHCP: pool network = interface network, default-router = interface address. Watch DISCOVER/OFFER/REQUEST/ACK in the packet list.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 220, startup: ['ip link set eth0 up'], post: ['dhclient eth0'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 120, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 520,
      y: 120,
      startup: cisco(
        'int Gi0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut',
        'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 192.168.1.1',
      ),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
  ],
  checks: [
    { type: 'dhcp-bound', device: 'PC1' },
    { type: 'ping', src: 'PC1', dst: '192.168.1.1', family: 'v4' },
  ],
};

export const MODEL_SLAAC: LabJson = {
  schemaVersion: 1,
  id: 'lab-5-slaac-ping6',
  kind: 'model',
  level: 'intermediate',
  topics: ['ipv6', 'slaac'],
  name: 'IPv6 SLAAC + ping6',
  goal: 'R1 advertises 2001:db8:1::/64. PC1 and PC2 build their own global addresses from the prefix and their MAC (SLAAC), learn R1 as default router and ping6 each other.',
  description: 'The reference for IPv6 autoconfiguration: no DHCP, no manual addresses on the hosts — just Router Advertisements.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 320, startup: ['ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 560, y: 320, startup: ['ip link set eth0 up'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 180, startup: swPorts(3) },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 20,
      startup: cisco('int Gi0/0', 'ipv6 address 2001:db8:1::1/64', 'ipv6 nd prefix 2001:db8:1::/64', 'no ipv6 nd suppress-ra', 'no shut'),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/3' },
  ],
  checks: [
    { type: 'ping', src: 'PC1', dst: 'PC2', family: 'v6' },
    { type: 'ping', src: 'PC2', dst: '2001:db8:1::1', family: 'v6' },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------------------------------------

export const MODEL_OSPF: LabJson = {
  schemaVersion: 1,
  id: 'lab-6-ospf-area0',
  kind: 'model',
  level: 'advanced',
  topics: ['ospf', 'routing'],
  name: 'OSPF area 0, two routers',
  goal: 'R1 and R2 become FULL neighbours in area 0 and exchange their LANs, so PC1 pings PC2 without any static route. Read show ip ospf neighbor and show ip route on both.',
  description: 'The reference for dynamic routing: network statements select the interfaces, OSPF installs the routes marked O.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 240, startup: linuxHost('10.0.1.10/24', '10.0.1.1') },
    { kind: 'workstation', name: 'PC2', x: 700, y: 240, startup: linuxHost('10.0.2.10/24', '10.0.2.1') },
    { kind: 'switch', name: 'SW1', x: 200, y: 160, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW2', x: 560, y: 160, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 280,
      y: 40,
      startup: cisco(
        'int Gi0/0', 'ip address 10.0.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.0', 'no shut',
        'router ospf 1', 'router-id 1.1.1.1', 'network 10.0.1.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.255 area 0',
      ),
    },
    {
      kind: 'router',
      name: 'R2',
      x: 480,
      y: 40,
      startup: cisco(
        'int Gi0/0', 'ip address 10.0.2.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.0', 'no shut',
        'router ospf 1', 'router-id 2.2.2.2', 'network 10.0.2.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.255 area 0',
      ),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/1', b: 'R2:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW2:Gi0/1' },
    { a: 'R2:Gi0/0', b: 'SW2:Gi0/2' },
  ],
  checks: [
    { type: 'ospf-full', a: 'R1', b: 'R2' },
    { type: 'ping', src: 'PC1', dst: '10.0.2.10', family: 'v4' },
  ],
};

export const MODEL_OSPF_TRIANGLE: LabJson = modelFromExercise(EX_OSPF_TRIANGLE, {
  id: 'model-ospf-three-routers',
  name: 'OSPF across three routers',
  goal: 'A triangle of routers in area 0 with a LAN at two corners. All three adjacencies are FULL and PC1 pings PC2 over the shortest path. Shut one link and watch OSPF reroute.',
  description: 'The reference for multi-router OSPF: every /30 and every LAN appears in a network statement on the router that owns it.',
  level: 'advanced',
});

export const MODEL_NAT: LabJson = modelFromExercise(EX_NAT, {
  id: 'model-nat-internet',
  name: 'Out to the Internet with NAT overload',
  goal: 'PC1 (192.168.1.10) pings 8.8.8.8. R1 translates the private source to its public address on Gi0/1 (overload/PAT) and undoes it for the reply. Read show ip nat translations after the ping.',
  description: 'The reference for NAT: inside/outside interface roles, an ACL that names the inside network, and the overload rule.',
  level: 'advanced',
});

export const MODEL_WIFI: LabJson = {
  schemaVersion: 1,
  id: 'lab-7-wifi-dhcp-ping',
  kind: 'model',
  level: 'advanced',
  topics: ['wifi', 'dhcp', 'vlan'],
  name: 'Wi-Fi: associate, DHCP, ping the wired server',
  goal: 'PC1 associates to CORP (WPA2-PSK), lands in VLAN 20, gets DHCP from R1 and pings SRV1 on the wired VLAN 10 through the router-on-a-stick.',
  description: 'The reference for an autonomous access point: SSID → VLAN mapping on AP1, trunk to the switch, DHCP pool for the Wi-Fi subnet.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 360, startup: [], post: ['nmcli wifi connect CORP password netbench'] },
    { kind: 'server', name: 'SRV1', x: 620, y: 160, startup: linuxHost('10.0.10.10/24', '10.0.10.1', 'systemctl start ssh') },
    {
      kind: 'switch',
      name: 'SW1',
      x: 360,
      y: 160,
      startup: cisco('vlan 10', 'vlan 20', ...access('Gi0/1', 10), ...trunk('Gi0/2', [10, 20]), ...access('Gi0/3', 20)),
    },
    {
      kind: 'router',
      name: 'R1',
      x: 360,
      y: 20,
      startup: cisco(
        'int Gi0/0', 'no shut', ...subif('Gi0/0', 10, '10.0.10.1'), ...subif('Gi0/0', 20, '10.0.20.1'),
        'ip dhcp pool WIFI', 'network 10.0.20.0 255.255.255.0', 'default-router 10.0.20.1',
      ),
    },
    {
      kind: 'ap',
      name: 'AP1',
      x: 160,
      y: 200,
      startup: cisco('ssid CORP', 'vlan 20', 'wpa2-psk netbench', 'channel 6', 'int Gi0/1', 'no shut', 'int wlan0', 'no shut'),
    },
  ],
  links: [
    { a: 'SRV1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'AP1:Gi0/1', b: 'SW1:Gi0/3' },
  ],
  checks: [
    { type: 'wifi-associated', client: 'PC1' },
    { type: 'dhcp-bound', device: 'PC1' },
    { type: 'ping', src: 'PC1', dst: '10.0.10.10', family: 'v4' },
  ],
};

export const MODEL_WLC: LabJson = modelFromExercise(EX_WLC, {
  id: 'model-wlc-capwap',
  name: 'Wi-Fi with a controller (WLC + CAPWAP)',
  goal: 'AP1 joins WLC1 over CAPWAP and receives the CORP WLAN (VLAN 20, PSK netbench). PC1 associates, gets DHCP from R1 and pings the wired server. Compare AP1’s config with the autonomous AP model.',
  description: 'The reference for controller-based Wi-Fi: the WLAN lives on the controller, the AP only knows where the controller is.',
  level: 'advanced',
});

export const MODEL_FIREWALL: LabJson = {
  schemaVersion: 1,
  id: 'lab-8-firewall-ssh',
  kind: 'model',
  level: 'advanced',
  topics: ['firewall', 'ssh', 'vlan', 'wifi'],
  name: 'Firewall: SSH from the jump host only',
  goal: 'JUMP (wired VLAN 10) can SSH to SRV1 behind FW1; WIFI-PC (VLAN 20) is denied. ICMP passes for everyone. Read FW1’s rules and trace both SSH attempts.',
  description: 'The reference for a stateful firewall between the campus and a server segment. FW1 evaluates its newest nft rule first.',
  devices: [
    { kind: 'workstation', name: 'JUMP', x: 40, y: 80, startup: linuxHost('10.0.10.20/24', '10.0.10.1') },
    { kind: 'workstation', name: 'WIFI-PC', x: 40, y: 500, startup: [], post: ['nmcli wifi connect CORP password netbench'] },
    { kind: 'server', name: 'SRV1', x: 680, y: 180, startup: linuxHost('10.0.30.10/24', '10.0.30.1', 'systemctl start ssh') },
    {
      kind: 'switch',
      name: 'SW1',
      x: 260,
      y: 180,
      startup: cisco('vlan 10', 'vlan 20', ...access('Gi0/1', 10), ...access('Gi0/2', 20), ...trunk('Gi0/3', [10, 20])),
    },
    { kind: 'switch', name: 'SW2', x: 520, y: 180, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 260,
      y: 20,
      startup: cisco(
        'int Gi0/0', 'no shut', ...subif('Gi0/0', 10, '10.0.10.1'), ...subif('Gi0/0', 20, '10.0.20.1'),
        'int Gi0/1', 'ip address 10.0.99.1 255.255.255.0', 'no shut',
        'ip route 10.0.30.0 255.255.255.0 10.0.99.2',
        'ip dhcp pool WIFI', 'network 10.0.20.0 255.255.255.0', 'default-router 10.0.20.1',
      ),
    },
    {
      kind: 'firewall',
      name: 'FW1',
      x: 460,
      y: 20,
      startup: [
        'ip addr add 10.0.99.2/24 dev eth0',
        'ip link set eth0 up',
        'ip addr add 10.0.30.1/24 dev eth1',
        'ip link set eth1 up',
        'ip route add default via 10.0.99.1',
        'nft add rule inet filter forward ip saddr 10.0.10.0/24 tcp dport 22 accept',
        'nft add rule inet filter forward ip saddr 10.0.10.0/24 ip protocol icmp accept',
        'nft add rule inet filter forward ip saddr 10.0.20.0/24 tcp dport 22 drop',
        'nft add rule inet filter forward ip protocol icmp accept',
      ],
    },
    {
      kind: 'ap',
      name: 'AP1',
      x: 120,
      y: 340,
      startup: cisco('ssid CORP', 'vlan 20', 'wpa2-psk netbench', 'channel 6', 'int Gi0/1', 'no shut', 'int wlan0', 'no shut'),
    },
  ],
  links: [
    { a: 'JUMP:eth0', b: 'SW1:Gi0/1' },
    { a: 'AP1:Gi0/1', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/3' },
    { a: 'R1:Gi0/1', b: 'FW1:eth0' },
    { a: 'FW1:eth1', b: 'SW2:Gi0/1' },
    { a: 'SRV1:eth0', b: 'SW2:Gi0/2' },
  ],
  checks: [
    { type: 'ssh', src: 'JUMP', dst: '10.0.30.10', expect: 'allow' },
    { type: 'ssh', src: 'WIFI-PC', dst: '10.0.30.10', expect: 'deny' },
    { type: 'ping', src: 'WIFI-PC', dst: '10.0.30.10', family: 'v4' },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Expert
// ---------------------------------------------------------------------------------------------------------

/** Three departments on two switches behind one router-on-a-stick; the working version of the "three faults" exercise. */
export const MODEL_OFFICE_THREE_DEPARTMENTS: LabJson = {
  schemaVersion: 1,
  id: 'model-office-three-departments',
  kind: 'model',
  level: 'expert',
  topics: ['vlan', 'trunk', 'router-on-a-stick', 'ssh'],
  name: 'Office: three departments, two switches',
  goal: 'Sales (VLAN 10), Engineering (VLAN 20) and HR (VLAN 30) each have PCs on both switches; SRV1 is the HR file server. Same-VLAN traffic crosses the SW1–SW2 trunk, inter-VLAN traffic goes up the trunk to R1 and back.',
  description: 'The reference for a small office: consistent access VLANs on both switches, trunks that allow every VLAN, one sub-interface per VLAN on R1 with the .1 gateway.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 40, y: 380, startup: linuxHost('10.0.10.11/24', '10.0.10.1') },
    { kind: 'workstation', name: 'PC2', x: 200, y: 380, startup: linuxHost('10.0.20.11/24', '10.0.20.1') },
    { kind: 'workstation', name: 'PC3', x: 360, y: 380, startup: linuxHost('10.0.30.11/24', '10.0.30.1') },
    { kind: 'workstation', name: 'PC4', x: 560, y: 380, startup: linuxHost('10.0.10.12/24', '10.0.10.1') },
    { kind: 'workstation', name: 'PC5', x: 720, y: 380, startup: linuxHost('10.0.20.12/24', '10.0.20.1') },
    { kind: 'workstation', name: 'PC6', x: 880, y: 380, startup: linuxHost('10.0.30.12/24', '10.0.30.1') },
    { kind: 'server', name: 'SRV1', x: 1040, y: 380, startup: linuxHost('10.0.30.10/24', '10.0.30.1', 'systemctl start ssh') },
    {
      kind: 'switch',
      name: 'SW1',
      x: 200,
      y: 200,
      startup: cisco('vlan 10', 'vlan 20', 'vlan 30', ...access('Gi0/1', 10), ...access('Gi0/2', 20), ...access('Gi0/3', 30), ...trunk('Gi0/7', [10, 20, 30]), ...trunk('Gi0/8', [10, 20, 30])),
    },
    {
      kind: 'switch',
      name: 'SW2',
      x: 800,
      y: 200,
      startup: cisco('vlan 10', 'vlan 20', 'vlan 30', ...access('Gi0/1', 10), ...access('Gi0/2', 20), ...access('Gi0/3', 30), ...access('Gi0/4', 30), ...trunk('Gi0/7', [10, 20, 30])),
    },
    {
      kind: 'router',
      name: 'R1',
      x: 200,
      y: 40,
      startup: cisco('int Gi0/0', 'no shut', ...subif('Gi0/0', 10, '10.0.10.1'), ...subif('Gi0/0', 20, '10.0.20.1'), ...subif('Gi0/0', 30, '10.0.30.1')),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'PC3:eth0', b: 'SW1:Gi0/3' },
    { a: 'PC4:eth0', b: 'SW2:Gi0/1' },
    { a: 'PC5:eth0', b: 'SW2:Gi0/2' },
    { a: 'PC6:eth0', b: 'SW2:Gi0/3' },
    { a: 'SRV1:eth0', b: 'SW2:Gi0/4' },
    { a: 'SW1:Gi0/7', b: 'SW2:Gi0/7' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/8' },
  ],
  checks: [
    { type: 'ping', src: 'PC1', dst: '10.0.10.12', family: 'v4' },
    { type: 'ping', src: 'PC3', dst: '10.0.30.12', family: 'v4' },
    { type: 'ping', src: 'PC1', dst: '10.0.20.12', family: 'v4' },
    { type: 'ping', src: 'PC2', dst: '10.0.30.10', family: 'v4' },
    { type: 'ssh', src: 'PC3', dst: '10.0.30.10', expect: 'allow' },
  ],
};

export const MODEL_CAMPUS: LabJson = modelFromExercise(EX_CAMPUS_SERVER_UNREACHABLE, {
  id: 'model-campus-ospf-firewall',
  name: 'Campus: OSPF core + firewalled server room',
  goal: 'Three OSPF routers carry the user LANs; R3 hands the server segment 10.9.9.0/24 to FW1 with a static route and R1/R2 default towards R3. FW1 lets ICMP through for everyone and SSH only from the admin LAN 10.1.1.0/24.',
  description: 'The reference for combining dynamic routing, a static route to a segment outside OSPF, and a firewall in the path. Trace ADMIN → SRV1 and PC-B → SRV1 (SSH) to see the difference.',
  level: 'expert',
});

/** Two LANs, two routers, IPv4 static routes and IPv6 static routes side by side; hosts autoconfigure IPv6. */
export const MODEL_DUAL_STACK_ROUTED: LabJson = {
  schemaVersion: 1,
  id: 'model-dual-stack-routed',
  kind: 'model',
  level: 'expert',
  topics: ['ipv6', 'ipv4', 'static-routes', 'slaac'],
  name: 'Dual-stack across two routers',
  goal: 'PC1 and PC2 sit on two LANs joined by R1–R2. IPv4 uses static addresses and static routes; IPv6 uses SLAAC on the LANs and static routes on the routers. Both pings must work.',
  description: 'The reference for running IPv4 and IPv6 side by side: every link has two addresses, every router has two routing tables (show ip route, show ipv6 route).',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 300, startup: linuxHost('10.1.1.10/24', '10.1.1.1') },
    { kind: 'workstation', name: 'PC2', x: 780, y: 300, startup: linuxHost('10.2.2.10/24', '10.2.2.1') },
    { kind: 'switch', name: 'SW1', x: 220, y: 300, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW2', x: 620, y: 300, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 220,
      y: 80,
      startup: cisco(
        'int Gi0/0', 'ip address 10.1.1.1 255.255.255.0', 'ipv6 address 2001:db8:1::1/64', 'ipv6 nd prefix 2001:db8:1::/64', 'no ipv6 nd suppress-ra', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.252', 'ipv6 address 2001:db8:12::1/64', 'no shut',
        'ip route 10.2.2.0 255.255.255.0 10.0.12.2',
        'ipv6 route 2001:db8:2::/64 2001:db8:12::2',
      ),
    },
    {
      kind: 'router',
      name: 'R2',
      x: 620,
      y: 80,
      startup: cisco(
        'int Gi0/0', 'ip address 10.2.2.1 255.255.255.0', 'ipv6 address 2001:db8:2::1/64', 'ipv6 nd prefix 2001:db8:2::/64', 'no ipv6 nd suppress-ra', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.252', 'ipv6 address 2001:db8:12::2/64', 'no shut',
        'ip route 10.1.1.0 255.255.255.0 10.0.12.1',
        'ipv6 route 2001:db8:1::/64 2001:db8:12::1',
      ),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/1', b: 'R2:Gi0/1' },
    { a: 'R2:Gi0/0', b: 'SW2:Gi0/2' },
    { a: 'PC2:eth0', b: 'SW2:Gi0/1' },
  ],
  checks: [
    { type: 'ping', src: 'PC1', dst: '10.2.2.10', family: 'v4' },
    { type: 'ping', src: 'PC1', dst: 'PC2', family: 'v6' },
    { type: 'ping', src: 'PC2', dst: 'PC1', family: 'v6' },
  ],
};

/** Capstone: the builder's dual-stack office, shipped working (read it, break it, fix it). */
export const MODEL_CAPSTONE: LabJson = (() => {
  const lab = dualStackOfficeLab();
  return {
    ...lab,
    id: 'lab-13-dual-stack-office',
    kind: 'model',
    level: 'expert',
    topics: ['vlan', 'wifi', 'dhcp', 'ipv6', 'ssh', 'router-on-a-stick'],
    name: 'Capstone: dual-stack office',
    goal: `${lab.goal} Read every device's running-config, then break one thing and repair it with Check.`,
    description: 'VLAN 10 wired + VLAN 20 Wi-Fi behind one router-on-a-stick, IPv4 + IPv6 (SLAAC), DHCP for Wi-Fi, SSH on the server. The same topology Eve builds for "dual-stack office".',
    devices: lab.devices.map((d) => ({ ...d, x: d.x * 1.3 + 40, y: d.y * 1.3 + 20 })),
  } satisfies LabJson;
})();

/** In display order (level, then story). */
export const MODEL_LABS: LabJson[] = [
  MODEL_FIRST_PING,
  MODEL_TWO_SUBNETS,
  MODEL_STATIC_ROUTES,
  MODEL_ROAS,
  MODEL_TWO_SWITCHES_TRUNK,
  MODEL_DHCP,
  MODEL_SLAAC,
  MODEL_OSPF,
  MODEL_OSPF_TRIANGLE,
  MODEL_NAT,
  MODEL_WIFI,
  MODEL_WLC,
  MODEL_FIREWALL,
  MODEL_OFFICE_THREE_DEPARTMENTS,
  MODEL_CAMPUS,
  MODEL_DUAL_STACK_ROUTED,
  MODEL_CAPSTONE,
];
