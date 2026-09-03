/**
 * Exercise labs: every one of them ships broken or incomplete and fails Check on purpose.
 * `solution.patch` is the official repair (same shape as apply_lab_patch); the curriculum test applies it and
 * asserts Check turns green. `modelId` points at the model lab that shows the working version.
 * Keep the goal honest about the symptom, put the give-away in the last hint, not in the goal.
 */
import { SW_TWO_PORTS, access, cisco, linuxHost, subif, swPorts, trunk } from './labs-shared.ts';
import type { LabJson } from './types.ts';

// ---------------------------------------------------------------------------------------------------------
// Beginner — one PC, one switch, one thing missing
// ---------------------------------------------------------------------------------------------------------

export const EX_PLUG_CABLE: LabJson = {
  schemaVersion: 1,
  id: 'lab-0a-plug-the-cable',
  kind: 'exercise',
  level: 'beginner',
  topics: ['cabling'],
  modelId: 'lab-1-first-ipv4-ping',
  name: 'Plug in the cable',
  goal: 'PC2 is not connected to anything. Cable PC2 to SW1 so that PC1 can ping 10.0.0.20.',
  description: 'Both PCs already have addresses. Only a cable is missing — use Cable, then tap PC2 and SW1.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: linuxHost('10.0.0.10/24') },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: linuxHost('10.0.0.20/24') },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: SW_TWO_PORTS },
  ],
  links: [{ a: 'PC1:eth0', b: 'SW1:Gi0/1' }],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
  solution: {
    summary: 'PC2 had an address but no cable, so its frames had nowhere to go. One Ethernet cable from PC2 eth0 to a free, enabled switch port (SW1 Gi0/2) puts both PCs in the same broadcast domain and ARP + ICMP work.',
    hints: [
      'Count the cables reaching PC2 on the canvas.',
      'A wired PC needs exactly one cable to a switch port that is enabled. SW1 already has Gi0/2 up and free.',
      'Pick Cable, click PC2, then SW1 (Advanced view: PC2 eth0 → SW1 Gi0/2). Then press Check.',
    ],
    patch: { addLinks: [{ a: 'PC2:eth0', b: 'SW1:Gi0/2' }] },
  },
};

export const EX_FIRST_ADDRESS: LabJson = {
  schemaVersion: 1,
  id: 'lab-0b-first-address',
  kind: 'exercise',
  level: 'beginner',
  topics: ['ipv4'],
  modelId: 'lab-1-first-ipv4-ping',
  name: 'Give PC2 an address',
  goal: 'PC2 is cabled but has no IPv4 address. Give it 10.0.0.20/24 so that PC1 can ping it.',
  description: 'Select PC2 and use Add IP, or type the ip command in its terminal.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: linuxHost('10.0.0.10/24') },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: ['ip link set eth0 up'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: SW_TWO_PORTS },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
  solution: {
    summary: 'A host without an IPv4 address cannot answer ARP for 10.0.0.20, so PC1 never learns a MAC to send the ping to. Adding 10.0.0.20/24 on eth0 puts PC2 in the same /24 as PC1.',
    hints: [
      'Select PC2 and read its card: which address does it have on eth0?',
      'PC1 is 10.0.0.10/24. PC2 must be in the same network with the same /24 mask.',
      'On PC2: ip addr add 10.0.0.20/24 dev eth0',
    ],
    patch: { configs: [{ device: 'PC2', commands: ['ip addr add 10.0.0.20/24 dev eth0'] }] },
  },
};

export const EX_PORT_SHUTDOWN: LabJson = {
  schemaVersion: 1,
  id: 'lab-0c-port-shutdown',
  kind: 'exercise',
  level: 'beginner',
  topics: ['switching'],
  modelId: 'lab-1-first-ipv4-ping',
  name: 'Turn the port on',
  goal: 'Everything is cabled and addressed, yet PC1 cannot ping PC2. One switch port is administratively down — find it and enable it.',
  description: 'Look at the port lights on the cards, or select SW1 and read the hints.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: linuxHost('10.0.0.10/24') },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: linuxHost('10.0.0.20/24') },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: cisco('int Gi0/1', 'no shut', 'int Gi0/2', 'shutdown') },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
  solution: {
    summary: 'SW1 Gi0/2 — the port PC2 is cabled to — was left in shutdown, so the link never came up and the switch dropped every frame to PC2. "no shutdown" on that interface brings the link up.',
    hints: [
      'The cable is fine; look at the port LEDs on SW1. One of them is off.',
      'On SW1: show ip interface brief (or show interfaces status) lists which port is administratively down.',
      'On SW1: enable, conf t, interface Gi0/2, no shutdown, end.',
    ],
    patch: { configs: [{ device: 'SW1', commands: cisco('int Gi0/2', 'no shutdown') }] },
  },
};

export const EX_WRONG_MASK: LabJson = {
  schemaVersion: 1,
  id: 'lab-2b-wrong-mask',
  kind: 'exercise',
  level: 'beginner',
  topics: ['ipv4', 'subnetting'],
  modelId: 'lab-1-first-ipv4-ping',
  name: 'Find the fault: wrong subnet mask',
  goal: 'PC1 (10.0.0.10/24) must ping PC2 at 10.0.0.200. The ping reaches PC2 but the reply never comes back — something in PC2’s addressing is wrong.',
  description: 'Trace the ping: the request arrives, the reply is dropped on PC2 itself.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: linuxHost('10.0.0.10/24') },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: linuxHost('10.0.0.200/25') },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: SW_TWO_PORTS },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.200', family: 'v4' }],
  solution: {
    summary: 'PC2 was configured as 10.0.0.200/25. With a /25 its network is 10.0.0.128–10.0.0.255, so PC2 believes 10.0.0.10 is on another network and, having no gateway, drops the reply. Re-addressing PC2 as /24 puts both hosts in one network again.',
    hints: [
      'Use Troubleshoot on the failing check: where is the reply dropped, and what does the reason say?',
      'Compare the masks: PC1 is /24. What range does PC2’s /25 cover, and is 10.0.0.10 inside it?',
      'On PC2: ip addr del 10.0.0.200/25 dev eth0, then ip addr add 10.0.0.200/24 dev eth0.',
    ],
    patch: { configs: [{ device: 'PC2', commands: ['ip addr del 10.0.0.200/25 dev eth0', 'ip addr add 10.0.0.200/24 dev eth0'] }] },
  },
};

export const EX_WRONG_GATEWAY: LabJson = {
  schemaVersion: 1,
  id: 'ex-wrong-gateway',
  kind: 'exercise',
  level: 'beginner',
  topics: ['ipv4', 'routing'],
  modelId: 'lab-2-two-subnets-router',
  name: 'Find the fault: wrong default gateway',
  goal: 'PC1 (10.0.0.10) must ping PC2 (10.0.1.20) through R1. The request arrives at PC2, but PC2 sends its reply to a gateway that does not exist.',
  description: 'Two subnets and one router. R1 is fine; the fault is on a PC.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 220, startup: linuxHost('10.0.0.10/24', '10.0.0.1') },
    { kind: 'workstation', name: 'PC2', x: 560, y: 220, startup: linuxHost('10.0.1.20/24', '10.0.1.254') },
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
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.1.20', family: 'v4' }],
  solution: {
    summary: 'PC2’s default route pointed at 10.0.1.254, an address nobody owns, so ARP for the gateway never got an answer and every reply to another subnet died on PC2. The gateway for 10.0.1.0/24 is R1 Gi0/1 = 10.0.1.1.',
    hints: [
      'Troubleshoot the check: the request reaches PC2, so look at what PC2 does with the reply.',
      'On PC2 run ip route. Which gateway does the default route use? Which address does R1 have on PC2’s side?',
      'On PC2: ip route replace default via 10.0.1.1',
    ],
    patch: { configs: [{ device: 'PC2', commands: ['ip route replace default via 10.0.1.1'] }] },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Intermediate — VLANs, trunks, sub-interfaces, DHCP, IPv6
// ---------------------------------------------------------------------------------------------------------

export const EX_WRONG_ACCESS_VLAN: LabJson = {
  schemaVersion: 1,
  id: 'ex-wrong-access-vlan',
  kind: 'exercise',
  level: 'intermediate',
  topics: ['vlan', 'switching'],
  modelId: 'lab-3-vlans-roas',
  name: 'Find the fault: PC in the wrong VLAN',
  goal: 'PC1 (VLAN 10) must ping PC2 (10.0.20.20, VLAN 20) through R1’s sub-interfaces. PC2 is addressed for VLAN 20, but the switch port it is plugged into says otherwise.',
  description: 'Router-on-a-stick with two VLANs. The router config is correct.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 320, startup: linuxHost('10.0.10.10/24', '10.0.10.1') },
    { kind: 'workstation', name: 'PC2', x: 560, y: 320, startup: linuxHost('10.0.20.20/24', '10.0.20.1') },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 180,
      startup: cisco('vlan 10', 'vlan 20', 'vlan 30', ...access('Gi0/1', 10), ...access('Gi0/2', 30), ...trunk('Gi0/8', [10, 20, 30])),
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
  solution: {
    summary: 'SW1 Gi0/2 was an access port in VLAN 30, so PC2’s frames were tagged 30 on the trunk and R1 has no sub-interface for VLAN 30 — its ARP for 10.0.20.20 went out on VLAN 20 and never reached PC2. Moving Gi0/2 to VLAN 20 matches the port to PC2’s address.',
    hints: [
      'On SW1: show vlan. Which VLAN is Gi0/2 in, and which VLAN does 10.0.20.0/24 belong to on R1?',
      'R1 has sub-interfaces for VLAN 10 and VLAN 20 only. A PC in any other VLAN has no gateway.',
      'On SW1: enable, conf t, interface Gi0/2, switchport access vlan 20, end.',
    ],
    patch: { configs: [{ device: 'SW1', commands: cisco('int Gi0/2', 'switchport access vlan 20') }] },
  },
};

export const EX_TRUNK_ALLOWED_VLAN: LabJson = {
  schemaVersion: 1,
  id: 'ex-trunk-allowed-vlan',
  kind: 'exercise',
  level: 'intermediate',
  topics: ['vlan', 'trunk', 'switching'],
  modelId: 'model-two-switches-trunk',
  name: 'Find the fault: the trunk forgot a VLAN',
  goal: 'Two switches share a trunk. VLAN 10 works across it (PC1 → PC3), but VLAN 20 does not: PC2 must ping PC4 (10.0.20.40).',
  description: 'No router here — same-VLAN traffic only has to cross the SW1–SW2 trunk.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 320, startup: linuxHost('10.0.10.10/24') },
    { kind: 'workstation', name: 'PC2', x: 260, y: 320, startup: linuxHost('10.0.20.20/24') },
    { kind: 'workstation', name: 'PC3', x: 520, y: 320, startup: linuxHost('10.0.10.30/24') },
    { kind: 'workstation', name: 'PC4', x: 720, y: 320, startup: linuxHost('10.0.20.40/24') },
    {
      kind: 'switch',
      name: 'SW1',
      x: 160,
      y: 120,
      startup: cisco('vlan 10', 'vlan 20', ...access('Gi0/1', 10), ...access('Gi0/2', 20), ...trunk('Gi0/8', [10, 20])),
    },
    {
      kind: 'switch',
      name: 'SW2',
      x: 620,
      y: 120,
      startup: cisco('vlan 10', 'vlan 20', ...access('Gi0/1', 10), ...access('Gi0/2', 20), ...trunk('Gi0/8', [10])),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'PC3:eth0', b: 'SW2:Gi0/1' },
    { a: 'PC4:eth0', b: 'SW2:Gi0/2' },
    { a: 'SW1:Gi0/8', b: 'SW2:Gi0/8' },
  ],
  checks: [
    { type: 'ping', src: 'PC1', dst: '10.0.10.30', family: 'v4' },
    { type: 'ping', src: 'PC2', dst: '10.0.20.40', family: 'v4' },
  ],
  solution: {
    summary: 'SW2 Gi0/8 was a trunk that only allowed VLAN 10, so tagged VLAN 20 frames arriving from SW1 were dropped at the trunk. Both ends of a trunk must allow every VLAN that has to cross it.',
    hints: [
      'VLAN 10 crosses the trunk and VLAN 20 does not: the fault is on the trunk, not on the PCs.',
      'On both switches: show interfaces trunk. Compare the allowed VLAN lists of SW1 Gi0/8 and SW2 Gi0/8.',
      'On SW2: enable, conf t, interface Gi0/8, switchport trunk allowed vlan 10,20, end.',
    ],
    patch: { configs: [{ device: 'SW2', commands: cisco('int Gi0/8', 'switchport trunk allowed vlan 10,20') }] },
  },
};

export const EX_SUBIF_WRONG_ENCAP: LabJson = {
  schemaVersion: 1,
  id: 'ex-subif-wrong-encap',
  kind: 'exercise',
  level: 'intermediate',
  topics: ['vlan', 'router-on-a-stick'],
  modelId: 'lab-3-vlans-roas',
  name: 'Find the fault: sub-interface tagged with the wrong VLAN',
  goal: 'PC1 (VLAN 10) must ping PC2 (10.0.20.20, VLAN 20). The switch is correct; one of R1’s sub-interfaces is not listening on the VLAN it should.',
  description: 'Router-on-a-stick. Read R1’s running-config carefully — the addresses are right.',
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
      startup: cisco('int Gi0/0', 'no shut', ...subif('Gi0/0', 10, '10.0.10.1'), 'int Gi0/0.20', 'encapsulation dot1Q 200', 'ip address 10.0.20.1 255.255.255.0'),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/8' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.20.20', family: 'v4' }],
  solution: {
    summary: 'R1 Gi0/0.20 carried "encapsulation dot1Q 200": the sub-interface name is only a label, the encapsulation line decides which VLAN tag it serves. R1 was therefore gateway of a VLAN 200 that nobody uses, and VLAN 20 had no gateway. Setting dot1Q 20 fixes it.',
    hints: [
      'Troubleshoot the check: the packet reaches R1 tagged VLAN 10 and R1 has no way into VLAN 20. Why not?',
      'On R1: show running-config. For each sub-interface compare the number after "encapsulation dot1Q" with the VLAN the switch uses.',
      'On R1: enable, conf t, interface Gi0/0.20, encapsulation dot1Q 20, end.',
    ],
    patch: { configs: [{ device: 'R1', commands: cisco('int Gi0/0.20', 'encapsulation dot1Q 20') }] },
  },
};

export const EX_DHCP_POOL_NETWORK: LabJson = {
  schemaVersion: 1,
  id: 'ex-dhcp-wrong-pool',
  kind: 'exercise',
  level: 'intermediate',
  topics: ['dhcp', 'ipv4'],
  modelId: 'lab-4-dhcpv4',
  name: 'Find the fault: DHCP hands out the wrong network',
  goal: 'PC1 gets a lease from R1, but it cannot ping its gateway 192.168.1.1. The pool on R1 describes a network that is not the one on Gi0/0.',
  description: 'After fixing R1, PC1 must ask for a new lease: dhclient eth0.',
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
        'ip dhcp pool LAN', 'network 192.168.10.0 255.255.255.0', 'default-router 192.168.10.1', 'dns-server 192.168.10.1',
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
  solution: {
    summary: 'The pool said "network 192.168.10.0", so PC1 received 192.168.10.x with gateway 192.168.10.1 — an address R1 does not own on Gi0/0 (192.168.1.1). The lease "worked" but nothing was reachable. Pointing the pool at 192.168.1.0/24 with default-router 192.168.1.1 and renewing the lease fixes it.',
    hints: [
      'On PC1: ip addr and ip route. Which network did the lease put PC1 in? Which network is R1 Gi0/0 in?',
      'On R1: show running-config, section ip dhcp pool. The network and default-router must match the interface that faces the clients.',
      'On R1: ip dhcp pool LAN, network 192.168.1.0 255.255.255.0, default-router 192.168.1.1, dns-server 192.168.1.1. Then on PC1: dhclient eth0.',
    ],
    patch: {
      configs: [
        { device: 'R1', commands: cisco('ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 192.168.1.1') },
        { device: 'PC1', commands: ['dhclient eth0'] },
      ],
    },
  },
};

export const EX_RA_SUPPRESSED: LabJson = {
  schemaVersion: 1,
  id: 'ex-ipv6-ra-suppressed',
  kind: 'exercise',
  level: 'intermediate',
  topics: ['ipv6', 'slaac'],
  modelId: 'lab-5-slaac-ping6',
  name: 'Find the fault: no IPv6 addresses on the PCs',
  goal: 'PC1 and PC2 should build SLAAC addresses from R1’s prefix 2001:db8:1::/64 and ping6 each other, but neither PC has a global IPv6 address.',
  description: 'R1 has the prefix configured. Something stops it from announcing it.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 320, startup: ['ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 560, y: 320, startup: ['ip link set eth0 up'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 180, startup: swPorts(3) },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 20,
      startup: cisco('int Gi0/0', 'ipv6 address 2001:db8:1::1/64', 'ipv6 nd prefix 2001:db8:1::/64', 'ipv6 nd suppress-ra', 'no shut'),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/3' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: 'PC2', family: 'v6' }],
  solution: {
    summary: 'R1 Gi0/0 had "ipv6 nd suppress-ra": the prefix was configured but never advertised, so the hosts only had link-local addresses and ping6 to a global address failed. "no ipv6 nd suppress-ra" makes R1 send Router Advertisements and the PCs autoconfigure 2001:db8:1::/64 addresses.',
    hints: [
      'On PC1: ip -6 addr. Only fe80::? Then no Router Advertisement ever arrived.',
      'SLAAC needs the router to send RAs. On R1: show running-config, interface Gi0/0 — look for a line that suppresses them.',
      'On R1: enable, conf t, interface Gi0/0, no ipv6 nd suppress-ra, end.',
    ],
    patch: { configs: [{ device: 'R1', commands: cisco('int Gi0/0', 'no ipv6 nd suppress-ra') }] },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Advanced — routing, NAT, Wi-Fi, firewall
// ---------------------------------------------------------------------------------------------------------

export const EX_STATIC_ROUTES: LabJson = {
  schemaVersion: 1,
  id: 'lab-9-static-routes',
  kind: 'exercise',
  level: 'advanced',
  topics: ['routing', 'static-routes'],
  modelId: 'model-static-routes',
  name: 'Two routers, static routes',
  goal: 'PC1 (10.1.1.10) must ping PC2 (10.2.2.10) and back. Each router only knows its own networks — add the static route each one is missing.',
  description: 'A /30 point-to-point link between two routers. Trace the ping to see which router drops it and why.',
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
      startup: cisco('int Gi0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shut', 'int Gi0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shut'),
    },
    {
      kind: 'router',
      name: 'R2',
      x: 620,
      y: 80,
      startup: cisco('int Gi0/0', 'ip address 10.2.2.1 255.255.255.0', 'no shut', 'int Gi0/1', 'ip address 10.0.12.2 255.255.255.252', 'no shut'),
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
    { type: 'ping', src: 'PC2', dst: '10.1.1.10', family: 'v4' },
  ],
  solution: {
    summary: 'Routers only know their directly connected networks. R1 had no route to 10.2.2.0/24 and R2 none to 10.1.1.0/24, so each dropped the packet with "no route". One static route per router, pointing at the far end of the /30, completes the path in both directions.',
    hints: [
      'Troubleshoot PC1 → 10.2.2.10: which router drops it, and what is the reason?',
      'On R1: show ip route. There is nothing for 10.2.2.0/24. R2 is reachable at 10.0.12.2 — and R2 has the mirror-image problem.',
      'R1: ip route 10.2.2.0 255.255.255.0 10.0.12.2. R2: ip route 10.1.1.0 255.255.255.0 10.0.12.1.',
    ],
    patch: {
      configs: [
        { device: 'R1', commands: cisco('ip route 10.2.2.0 255.255.255.0 10.0.12.2') },
        { device: 'R2', commands: cisco('ip route 10.1.1.0 255.255.255.0 10.0.12.1') },
      ],
    },
  },
};

export const EX_STATIC_ROUTE_TYPO: LabJson = {
  schemaVersion: 1,
  id: 'ex-static-route-typo',
  kind: 'exercise',
  level: 'advanced',
  topics: ['routing', 'static-routes'],
  modelId: 'model-static-routes',
  name: 'Find the fault: static route with the wrong next hop',
  goal: 'PC2 (10.2.2.10) can reach PC1, but PC1 (10.1.1.10) cannot reach PC2. R1 does have a route to 10.2.2.0/24 — check where it points.',
  description: 'Same two-router topology; both routers have static routes this time.',
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
        'int Gi0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
        'ip route 10.2.2.0 255.255.255.0 10.0.12.6',
      ),
    },
    {
      kind: 'router',
      name: 'R2',
      x: 620,
      y: 80,
      startup: cisco(
        'int Gi0/0', 'ip address 10.2.2.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
        'ip route 10.1.1.0 255.255.255.0 10.0.12.1',
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
    { type: 'ping', src: 'PC2', dst: '10.1.1.10', family: 'v4' },
  ],
  solution: {
    summary: 'R1’s static route to 10.2.2.0/24 used next hop 10.0.12.6 — an address outside the 10.0.12.0/30 link, so R1 could never resolve it and dropped the packet. Removing the typo and pointing the route at R2’s real address 10.0.12.2 restores the forward path (the return path via R2 was already right).',
    hints: [
      'Troubleshoot PC1 → 10.2.2.10. R1 has a route, yet it drops the packet: read the reason.',
      'On R1: show ip route. Is the next hop of 10.2.2.0/24 an address on the 10.0.12.0/30 link? Which address does R2 Gi0/1 actually have?',
      'On R1: no ip route 10.2.2.0 255.255.255.0 10.0.12.6, then ip route 10.2.2.0 255.255.255.0 10.0.12.2.',
    ],
    patch: { configs: [{ device: 'R1', commands: cisco('no ip route 10.2.2.0 255.255.255.0 10.0.12.6', 'ip route 10.2.2.0 255.255.255.0 10.0.12.2') }] },
  },
};

export const EX_OSPF_TRIANGLE: LabJson = {
  schemaVersion: 1,
  id: 'lab-10-ospf-three-routers',
  kind: 'exercise',
  level: 'advanced',
  topics: ['ospf', 'routing'],
  modelId: 'model-ospf-three-routers',
  name: 'OSPF across three routers',
  goal: 'R1 and R2 already run OSPF area 0. R3 has the process but no network statements. Add them so R1–R3 and R2–R3 reach FULL and PC1 can ping PC2 (10.3.3.10).',
  description: 'A triangle of routers with a LAN on each end. R3 owns 10.0.13.0/30, 10.0.23.0/30 and 10.3.3.0/24.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 320, startup: linuxHost('10.1.1.10/24', '10.1.1.1') },
    { kind: 'workstation', name: 'PC2', x: 820, y: 320, startup: linuxHost('10.3.3.10/24', '10.3.3.1') },
    { kind: 'switch', name: 'SW1', x: 240, y: 320, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW2', x: 640, y: 320, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 240,
      y: 140,
      startup: cisco(
        'int Gi0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.13.1 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 1.1.1.1',
        'network 10.1.1.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.3 area 0', 'network 10.0.13.0 0.0.0.3 area 0',
      ),
    },
    {
      kind: 'router',
      name: 'R2',
      x: 440,
      y: 20,
      startup: cisco(
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.23.1 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 2.2.2.2',
        'network 10.0.12.0 0.0.0.3 area 0', 'network 10.0.23.0 0.0.0.3 area 0',
      ),
    },
    {
      kind: 'router',
      name: 'R3',
      x: 640,
      y: 140,
      startup: cisco(
        'int Gi0/0', 'ip address 10.3.3.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.23.2 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.13.2 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 3.3.3.3',
      ),
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/1', b: 'R2:Gi0/1' },
    { a: 'R2:Gi0/2', b: 'R3:Gi0/1' },
    { a: 'R1:Gi0/2', b: 'R3:Gi0/2' },
    { a: 'R3:Gi0/0', b: 'SW2:Gi0/2' },
    { a: 'PC2:eth0', b: 'SW2:Gi0/1' },
  ],
  checks: [
    { type: 'ospf-full', a: 'R1', b: 'R2' },
    { type: 'ospf-full', a: 'R1', b: 'R3' },
    { type: 'ospf-full', a: 'R2', b: 'R3' },
    { type: 'ping', src: 'PC1', dst: '10.3.3.10', family: 'v4' },
  ],
  solution: {
    summary: 'An OSPF process without network statements never sends a Hello, so R3 had no neighbours and nobody learnt 10.3.3.0/24. Three network statements (both /30 links plus the LAN, all in area 0) bring R1–R3 and R2–R3 to FULL and the LAN route appears on R1.',
    hints: [
      'On R3: show ip ospf neighbor is empty although the links are up. What tells OSPF which interfaces to run on?',
      'Compare R3’s "router ospf 1" section with R1’s. R3 has interfaces in 10.0.13.0/30, 10.0.23.0/30 and 10.3.3.0/24.',
      'On R3: router ospf 1, network 10.0.13.0 0.0.0.3 area 0, network 10.0.23.0 0.0.0.3 area 0, network 10.3.3.0 0.0.0.255 area 0.',
    ],
    patch: {
      configs: [
        { device: 'R3', commands: cisco('router ospf 1', 'network 10.0.13.0 0.0.0.3 area 0', 'network 10.0.23.0 0.0.0.3 area 0', 'network 10.3.3.0 0.0.0.255 area 0') },
      ],
    },
  },
};

export const EX_OSPF_INTERFACE_DOWN: LabJson = {
  schemaVersion: 1,
  id: 'ex-ospf-interface-down',
  kind: 'exercise',
  level: 'advanced',
  topics: ['ospf', 'routing'],
  modelId: 'lab-6-ospf-area0',
  name: 'Find the fault: OSPF neighbour never appears',
  goal: 'R1 and R2 are configured for OSPF area 0 with matching network statements, yet they never become neighbours and PC1 cannot ping PC2 (10.0.2.10).',
  description: 'The OSPF configuration is correct on both routers. Look one layer down.',
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
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.0', 'shutdown',
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
  solution: {
    summary: 'R2 Gi0/1 — the interface facing R1 — was administratively shut down. OSPF cannot form an adjacency over a down interface no matter how good the routing config is. "no shutdown" brings the link up, Hellos flow, the neighbours reach FULL and the LAN routes are exchanged.',
    hints: [
      'A routing protocol needs a working link first. On R1: show ip interface brief — is Gi0/1 up/up? Now the same on R2.',
      'On R2, Gi0/1 shows administratively down. OSPF network statements do nothing on an interface that is shut.',
      'On R2: enable, conf t, interface Gi0/1, no shutdown, end.',
    ],
    patch: { configs: [{ device: 'R2', commands: cisco('int Gi0/1', 'no shutdown') }] },
  },
};

export const EX_NAT: LabJson = {
  schemaVersion: 1,
  id: 'lab-11-nat-internet',
  kind: 'exercise',
  level: 'advanced',
  topics: ['nat', 'routing'],
  modelId: 'model-nat-internet',
  name: 'Out to the Internet with NAT',
  goal: 'PC1 (192.168.1.10) must ping 8.8.8.8. R1 has a default route to the Internet but no NAT, so replies to the private address never come back.',
  description: 'Gi0/0 is already "ip nat inside" and Gi0/1 "ip nat outside" — the translation rule itself is missing.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 260, startup: linuxHost('192.168.1.10/24', '192.168.1.1') },
    { kind: 'switch', name: 'SW1', x: 260, y: 260, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 460,
      y: 260,
      startup: cisco(
        'int Gi0/0', 'ip address 192.168.1.1 255.255.255.0', 'ip nat inside', 'no shut',
        'int Gi0/1', 'ip address 203.0.113.2 255.255.255.0', 'ip nat outside', 'no shut',
        'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
      ),
    },
    { kind: 'cloud', name: 'INET', x: 700, y: 260, startup: [] },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/1', b: 'INET:eth0' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '8.8.8.8', family: 'v4' }],
  solution: {
    summary: 'The ping left R1 with source 192.168.1.10, a private address the Internet cannot route back to, so the reply was lost. NAT overload rewrites the source to R1’s public address (Gi0/1) on the way out and reverses it on the way back. It needs an ACL naming the inside network plus the "ip nat inside source list … interface … overload" rule.',
    hints: [
      'Troubleshoot the ping: it leaves R1 fine. What source address does the packet carry when it reaches INET?',
      'Private addresses must be translated at the edge. On R1: show ip nat translations is empty — there is no NAT rule, only inside/outside markings.',
      'On R1: ip access-list standard LAN, permit 192.168.1.0 0.0.0.255, exit, ip nat inside source list LAN interface Gi0/1 overload.',
    ],
    patch: {
      configs: [{ device: 'R1', commands: cisco('ip access-list standard LAN', 'permit 192.168.1.0 0.0.0.255', 'ip nat inside source list LAN interface Gi0/1 overload') }],
    },
  },
};

export const EX_NAT_INSIDE_MISSING: LabJson = {
  schemaVersion: 1,
  id: 'ex-nat-inside-missing',
  kind: 'exercise',
  level: 'advanced',
  topics: ['nat', 'routing'],
  modelId: 'model-nat-internet',
  name: 'Find the fault: NAT rule present, nothing translated',
  goal: 'PC1 (192.168.1.10) must ping 8.8.8.8. R1 has the ACL, the overload rule and a default route, yet the Internet still sees the private address.',
  description: 'NAT is a rule plus two interface roles. One of the roles is missing.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 260, startup: linuxHost('192.168.1.10/24', '192.168.1.1') },
    { kind: 'switch', name: 'SW1', x: 260, y: 260, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 460,
      y: 260,
      startup: cisco(
        'int Gi0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 203.0.113.2 255.255.255.0', 'ip nat outside', 'no shut',
        'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
        'ip access-list standard LAN', 'permit 192.168.1.0 0.0.0.255',
        'ip nat inside source list LAN interface Gi0/1 overload',
      ),
    },
    { kind: 'cloud', name: 'INET', x: 700, y: 260, startup: [] },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/1', b: 'INET:eth0' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '8.8.8.8', family: 'v4' }],
  solution: {
    summary: 'The NAT rule only translates traffic that enters through an "ip nat inside" interface and leaves through an "ip nat outside" one. Gi0/0 (the LAN side) had no inside marking, so the rule never matched and the packet kept its private source. Marking Gi0/0 as inside completes the pair.',
    hints: [
      'The ACL and the overload rule are correct. Which two interface commands does NAT need, and on which interfaces?',
      'On R1: show running-config, interface Gi0/0 and Gi0/1. Which one has an "ip nat …" line and which one does not?',
      'On R1: enable, conf t, interface Gi0/0, ip nat inside, end.',
    ],
    patch: { configs: [{ device: 'R1', commands: cisco('int Gi0/0', 'ip nat inside') }] },
  },
};

export const EX_WIFI_WRONG_PSK: LabJson = {
  schemaVersion: 1,
  id: 'ex-wifi-wrong-psk',
  kind: 'exercise',
  level: 'advanced',
  topics: ['wifi', 'dhcp'],
  modelId: 'lab-7-wifi-dhcp-ping',
  name: 'Find the fault: nobody can join the Wi-Fi',
  goal: 'PC1 must associate to CORP with the documented password "netbench", get DHCP and ping SRV1 (10.0.10.10). The client uses the right password — the access point does not.',
  description: 'Fix the AP, then reconnect PC1: nmcli wifi connect CORP password netbench.',
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
      startup: cisco('ssid CORP', 'vlan 20', 'wpa2-psk netbnech', 'channel 6', 'int Gi0/1', 'no shut', 'int wlan0', 'no shut'),
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
  solution: {
    summary: 'AP1 had the pre-shared key typed as "netbnech". WPA2-PSK association fails when client and AP keys differ, so PC1 never joined, never got DHCP and never reached the server. Correcting the key on the AP and reconnecting the client fixes all three checks.',
    hints: [
      'On PC1 the connect attempt says WPA2-PSK mismatch. The client typed "netbench" — so who has the wrong key?',
      'On AP1: show running-config (or show ssid). Read the wpa2-psk line letter by letter.',
      'On AP1: enable, conf t, ssid CORP, wpa2-psk netbench, end. Then on PC1: nmcli wifi connect CORP password netbench.',
    ],
    patch: {
      configs: [
        { device: 'AP1', commands: cisco('ssid CORP', 'wpa2-psk netbench') },
        { device: 'PC1', commands: ['nmcli wifi connect CORP password netbench'] },
      ],
    },
  },
};

export const EX_FIREWALL_MISSING_ALLOW: LabJson = {
  schemaVersion: 1,
  id: 'ex-firewall-missing-allow',
  kind: 'exercise',
  level: 'advanced',
  topics: ['firewall', 'ssh', 'vlan'],
  modelId: 'lab-8-firewall-ssh',
  name: 'Find the fault: the firewall locks out the jump host',
  goal: 'SSH from JUMP (10.0.10.20) to SRV1 must work while SSH from WIFI-PC stays denied. Right now FW1 blocks SSH from everyone — including the jump host.',
  description: 'Keep the deny for the Wi-Fi VLAN; add what the jump host’s subnet needs. FW1 evaluates the newest nft rule first.',
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
        'nft add rule inet filter forward ip protocol icmp accept',
        'nft add rule inet filter forward tcp dport 22 drop',
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
  ],
  solution: {
    summary: 'FW1 had a blanket "tcp dport 22 drop" and no exception, so the jump host was denied together with the Wi-Fi clients. A more specific accept for 10.0.10.0/24 on port 22 — evaluated before the drop — lets the jump host through while everyone else still hits the drop.',
    hints: [
      'Troubleshoot the JUMP check: FW1 drops it with an ACL reason. Which rule matched?',
      'On FW1: show rules. There is a drop for port 22 but no accept for the jump host’s network 10.0.10.0/24.',
      'On FW1: nft add rule inet filter forward ip saddr 10.0.10.0/24 tcp dport 22 accept',
    ],
    patch: { configs: [{ device: 'FW1', commands: ['nft add rule inet filter forward ip saddr 10.0.10.0/24 tcp dport 22 accept'] }] },
  },
};

export const EX_WLC: LabJson = {
  schemaVersion: 1,
  id: 'lab-12-wlc-capwap',
  kind: 'exercise',
  level: 'advanced',
  topics: ['wifi', 'wlc', 'dhcp'],
  modelId: 'model-wlc-capwap',
  name: 'Wi-Fi with a controller (WLC)',
  goal: 'AP1 has no SSID of its own: it must join the controller (capwap controller 10.0.10.5) to receive the CORP WLAN. Then PC1 associates, gets DHCP and pings SRV1 (10.0.10.10).',
  description: 'The WLC already defines WLAN CORP on VLAN 20 with PSK netbench. Configure the AP, then on PC1: nmcli wifi connect CORP password netbench.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 320, startup: [] },
    { kind: 'server', name: 'SRV1', x: 740, y: 100, startup: linuxHost('10.0.10.10/24', '10.0.10.1', 'systemctl start ssh') },
    {
      kind: 'switch',
      name: 'SW1',
      x: 440,
      y: 200,
      startup: cisco('vlan 10', 'vlan 20', ...access('Gi0/1', 10), ...trunk('Gi0/2', [10, 20]), ...access('Gi0/3', 20), ...access('Gi0/4', 10)),
    },
    {
      kind: 'router',
      name: 'R1',
      x: 440,
      y: 20,
      startup: cisco(
        'int Gi0/0', 'no shut', ...subif('Gi0/0', 10, '10.0.10.1'), ...subif('Gi0/0', 20, '10.0.20.1'),
        'ip dhcp pool WIFI', 'network 10.0.20.0 255.255.255.0', 'default-router 10.0.20.1',
      ),
    },
    {
      kind: 'wlc',
      name: 'WLC1',
      x: 740,
      y: 300,
      startup: cisco('int Gi0/1', 'ip address 10.0.10.5 255.255.255.0', 'no shut', 'wlan create CORP vlan 20', 'wpa2 psk netbench'),
    },
    { kind: 'ap', name: 'AP1', x: 240, y: 200, startup: cisco('int Gi0/1', 'no shut', 'int wlan0', 'no shut') },
  ],
  links: [
    { a: 'SRV1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'AP1:Gi0/1', b: 'SW1:Gi0/3' },
    { a: 'WLC1:Gi0/1', b: 'SW1:Gi0/4' },
  ],
  checks: [
    { type: 'wifi-associated', client: 'PC1' },
    { type: 'dhcp-bound', device: 'PC1' },
    { type: 'ping', src: 'PC1', dst: '10.0.10.10', family: 'v4' },
  ],
  solution: {
    summary: 'A lightweight AP has no WLAN until it joins a controller over CAPWAP. Pointing AP1 at WLC1 (10.0.10.5) makes it download the CORP WLAN (VLAN 20, PSK netbench); PC1 can then associate, DHCP from R1 answers on VLAN 20 and the wired server is one routed hop away.',
    hints: [
      'On AP1: show ssid prints nothing. Where does a controller-managed AP get its WLANs from?',
      'WLC1 answers at 10.0.10.5 and already has the CORP WLAN. The AP needs one line naming that controller.',
      'On AP1: enable, conf t, capwap controller 10.0.10.5, end. Then on PC1: nmcli wifi connect CORP password netbench.',
    ],
    patch: {
      configs: [
        { device: 'AP1', commands: cisco('capwap controller 10.0.10.5') },
        { device: 'PC1', commands: ['nmcli wifi connect CORP password netbench'] },
      ],
    },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Expert — several faults at once, bigger topologies
// ---------------------------------------------------------------------------------------------------------

/** Three departments across two switches; same topology as the model, with three independent faults. */
export const EX_OFFICE_THREE_FAULTS: LabJson = {
  schemaVersion: 1,
  id: 'ex-office-three-faults',
  kind: 'exercise',
  level: 'expert',
  topics: ['vlan', 'trunk', 'router-on-a-stick', 'troubleshooting'],
  modelId: 'model-office-three-departments',
  name: 'Office outage: three faults, one ticket',
  goal: 'Sales (VLAN 10), Engineering (VLAN 20) and HR (VLAN 30) span two switches behind R1. Three things are wrong — a port, a trunk and a gateway. All five checks must pass.',
  description: 'Work one failing check at a time: same-VLAN across the trunk first, then inter-VLAN, then the server. Use show vlan, show interfaces trunk and R1’s running-config.',
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
      // Fault 1: PC4 is in VLAN 20 instead of 10.  Fault 2: the trunk to SW1 forgot VLAN 30.
      startup: cisco('vlan 10', 'vlan 20', 'vlan 30', ...access('Gi0/1', 20), ...access('Gi0/2', 20), ...access('Gi0/3', 30), ...access('Gi0/4', 30), ...trunk('Gi0/7', [10, 20])),
    },
    {
      kind: 'router',
      name: 'R1',
      x: 200,
      y: 40,
      // Fault 3: VLAN 30 sub-interface exists but has no address, so HR has no gateway.
      startup: cisco('int Gi0/0', 'no shut', ...subif('Gi0/0', 10, '10.0.10.1'), ...subif('Gi0/0', 20, '10.0.20.1'), 'int Gi0/0.30', 'encapsulation dot1Q 30'),
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
  solution: {
    summary: 'Three unrelated faults: (1) SW2 Gi0/1 put PC4 in VLAN 20 although it is addressed for Sales/VLAN 10; (2) SW2’s trunk Gi0/7 only allowed VLANs 10,20, so HR traffic (VLAN 30) could not cross between the switches; (3) R1’s Gi0/0.30 sub-interface had the encapsulation but no IP address, so VLAN 30 had no gateway and nobody could reach the HR server from another VLAN. Fix the access VLAN, the allowed-VLAN list and the sub-interface address.',
    hints: [
      'Start with same-VLAN pings. PC1 → PC4 fails inside VLAN 10: on SW2, show vlan — is Gi0/1 where PC4 (10.0.10.12) belongs? PC3 → PC6 fails inside VLAN 30: compare show interfaces trunk on SW1 and SW2.',
      'Then inter-VLAN: PC2 → SRV1 and PC3’s gateway 10.0.30.1. On R1: show ip interface brief — which sub-interface has no address?',
      'SW2: interface Gi0/1, switchport access vlan 10; interface Gi0/7, switchport trunk allowed vlan 10,20,30. R1: interface Gi0/0.30, ip address 10.0.30.1 255.255.255.0.',
    ],
    patch: {
      configs: [
        { device: 'SW2', commands: cisco('int Gi0/1', 'switchport access vlan 10', 'int Gi0/7', 'switchport trunk allowed vlan 10,20,30') },
        { device: 'R1', commands: cisco('int Gi0/0.30', 'ip address 10.0.30.1 255.255.255.0') },
      ],
    },
  },
};

/** OSPF triangle + firewalled server segment; two faults on the path to the servers. */
export const EX_CAMPUS_SERVER_UNREACHABLE: LabJson = {
  schemaVersion: 1,
  id: 'ex-campus-server-unreachable',
  kind: 'exercise',
  level: 'expert',
  topics: ['ospf', 'static-routes', 'firewall', 'troubleshooting'],
  modelId: 'model-campus-ospf-firewall',
  name: 'Campus: the server room is unreachable',
  goal: 'Three OSPF routers, one firewall, one server segment (10.9.9.0/24). OSPF is FULL everywhere, yet nobody reaches SRV1 and the admin PC cannot SSH to it. Two faults: one route, one firewall rule.',
  description: 'R3 is the only router that touches FW1. Check how R3 reaches 10.9.9.0/24, then read FW1’s rules. Wi-Fi is not involved here.',
  devices: [
    { kind: 'workstation', name: 'ADMIN', x: 40, y: 420, startup: linuxHost('10.1.1.10/24', '10.1.1.1') },
    { kind: 'workstation', name: 'PC-B', x: 1000, y: 420, startup: linuxHost('10.2.2.10/24', '10.2.2.1') },
    { kind: 'server', name: 'SRV1', x: 520, y: 620, startup: linuxHost('10.9.9.10/24', '10.9.9.1', 'systemctl start ssh') },
    { kind: 'switch', name: 'SW-A', x: 200, y: 420, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW-B', x: 840, y: 420, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW-DMZ', x: 520, y: 480, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 200,
      y: 200,
      startup: cisco(
        'int Gi0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.13.1 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 1.1.1.1',
        'network 10.1.1.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.3 area 0', 'network 10.0.13.0 0.0.0.3 area 0',
        'ip route 0.0.0.0 0.0.0.0 10.0.13.2',
      ),
    },
    {
      kind: 'router',
      name: 'R2',
      x: 840,
      y: 200,
      startup: cisco(
        'int Gi0/0', 'ip address 10.2.2.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.23.1 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 2.2.2.2',
        'network 10.2.2.0 0.0.0.255 area 0', 'network 10.0.12.0 0.0.0.3 area 0', 'network 10.0.23.0 0.0.0.3 area 0',
        'ip route 0.0.0.0 0.0.0.0 10.0.23.2',
      ),
    },
    {
      kind: 'router',
      name: 'R3',
      x: 520,
      y: 40,
      // Fault 1: no route to the server segment behind FW1.
      startup: cisco(
        'int Gi0/1', 'ip address 10.0.23.2 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.13.2 255.255.255.252', 'no shut',
        'int Gi0/3', 'ip address 10.0.39.1 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 3.3.3.3',
        'network 10.0.13.0 0.0.0.3 area 0', 'network 10.0.23.0 0.0.0.3 area 0', 'network 10.0.39.0 0.0.0.3 area 0',
      ),
    },
    {
      kind: 'firewall',
      name: 'FW1',
      x: 520,
      y: 280,
      // Fault 2: SSH is dropped for everyone; the admin subnet needs an accept.
      startup: [
        'ip addr add 10.0.39.2/30 dev eth0',
        'ip link set eth0 up',
        'ip addr add 10.9.9.1/24 dev eth1',
        'ip link set eth1 up',
        'ip route add default via 10.0.39.1',
        'nft add rule inet filter forward ip protocol icmp accept',
        'nft add rule inet filter forward tcp dport 22 drop',
      ],
    },
  ],
  links: [
    { a: 'ADMIN:eth0', b: 'SW-A:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW-A:Gi0/2' },
    { a: 'PC-B:eth0', b: 'SW-B:Gi0/1' },
    { a: 'R2:Gi0/0', b: 'SW-B:Gi0/2' },
    { a: 'R1:Gi0/1', b: 'R2:Gi0/1' },
    { a: 'R1:Gi0/2', b: 'R3:Gi0/2' },
    { a: 'R2:Gi0/2', b: 'R3:Gi0/1' },
    { a: 'R3:Gi0/3', b: 'FW1:eth0' },
    { a: 'FW1:eth1', b: 'SW-DMZ:Gi0/1' },
    { a: 'SRV1:eth0', b: 'SW-DMZ:Gi0/2' },
  ],
  checks: [
    { type: 'ospf-full', a: 'R1', b: 'R2' },
    { type: 'ospf-full', a: 'R1', b: 'R3' },
    { type: 'ospf-full', a: 'R2', b: 'R3' },
    { type: 'ping', src: 'ADMIN', dst: '10.9.9.10', family: 'v4' },
    { type: 'ping', src: 'PC-B', dst: '10.9.9.10', family: 'v4' },
    { type: 'ssh', src: 'ADMIN', dst: '10.9.9.10', expect: 'allow' },
    { type: 'ssh', src: 'PC-B', dst: '10.9.9.10', expect: 'deny' },
  ],
  solution: {
    summary: 'R1 and R2 send everything unknown to R3 (default routes), but R3 had no route to 10.9.9.0/24 — the segment behind FW1 is not in OSPF — so it dropped every packet for the servers. A static route on R3 via FW1 (10.0.39.2) fixes reachability. Then FW1 dropped SSH for every source; a specific accept for the admin subnet 10.1.1.0/24 on port 22, evaluated before the drop, lets the admins in while PC-B stays denied.',
    hints: [
      'Troubleshoot ADMIN → 10.9.9.10: it travels R1 → R3 and dies on R3 with "no route". OSPF only knows the networks in the network statements — is 10.9.9.0/24 one of them anywhere?',
      'R3 reaches FW1 at 10.0.39.2 and FW1 owns 10.9.9.1. Give R3 a static route for 10.9.9.0/24. Then re-run Check: pings pass, the ADMIN SSH still fails — on FW1: show rules.',
      'R3: ip route 10.9.9.0 255.255.255.0 10.0.39.2. FW1: nft add rule inet filter forward ip saddr 10.1.1.0/24 tcp dport 22 accept.',
    ],
    patch: {
      configs: [
        { device: 'R3', commands: cisco('ip route 10.9.9.0 255.255.255.0 10.0.39.2') },
        { device: 'FW1', commands: ['nft add rule inet filter forward ip saddr 10.1.1.0/24 tcp dport 22 accept'] },
      ],
    },
  },
};

/** In display order (level, then story). */
export const EXERCISE_LABS: LabJson[] = [
  EX_PLUG_CABLE,
  EX_FIRST_ADDRESS,
  EX_PORT_SHUTDOWN,
  EX_WRONG_MASK,
  EX_WRONG_GATEWAY,
  EX_WRONG_ACCESS_VLAN,
  EX_TRUNK_ALLOWED_VLAN,
  EX_SUBIF_WRONG_ENCAP,
  EX_DHCP_POOL_NETWORK,
  EX_RA_SUPPRESSED,
  EX_STATIC_ROUTES,
  EX_STATIC_ROUTE_TYPO,
  EX_OSPF_TRIANGLE,
  EX_OSPF_INTERFACE_DOWN,
  EX_NAT,
  EX_NAT_INSIDE_MISSING,
  EX_WIFI_WRONG_PSK,
  EX_FIREWALL_MISSING_ALLOW,
  EX_WLC,
  EX_OFFICE_THREE_FAULTS,
  EX_CAMPUS_SERVER_UNREACHABLE,
];
