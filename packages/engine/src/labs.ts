import type { LabJson } from './types.ts';

export const LAB_FIRST_PING: LabJson = {
  schemaVersion: 1,
  id: 'lab-1-first-ipv4-ping',
  name: 'First IPv4 ping',
  goal: 'PC1 should ping PC2 on the same VLAN. Both PCs and the switch ports are already addressed and up.',
  description: 'Two Linux workstations on an L2 switch. Confirm L2 + ARP + ICMP.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 200, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 520, y: 200, startup: ['ip addr add 10.0.0.20/24 dev eth0', 'ip link set eth0 up'] },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 80,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
};

export const LAB_GATEWAY: LabJson = {
  schemaVersion: 1,
  id: 'lab-2-missing-gateway',
  name: 'Missing gateway / wrong mask',
  goal: 'PC1 (10.0.0.10/24) must ping PC2 (10.0.1.20/24) via R1. A typical junior fault is a missing default gateway or wrong mask.',
  description: 'Two subnets and an edge router.',
  devices: [
    {
      kind: 'workstation',
      name: 'PC1',
      x: 80,
      y: 220,
      startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.0.1'],
    },
    {
      kind: 'workstation',
      name: 'PC2',
      x: 560,
      y: 220,
      startup: ['ip addr add 10.0.1.20/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.1.1'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 200,
      y: 80,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
    {
      kind: 'switch',
      name: 'SW2',
      x: 440,
      y: 80,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 40,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 10.0.0.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.1.1 255.255.255.0', 'no shut',
        'end',
      ],
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'PC2:eth0', b: 'SW2:Gi0/1' },
    { a: 'R1:Gi0/1', b: 'SW2:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.1.20', family: 'v4' }],
};

export const LAB_ROAS: LabJson = {
  schemaVersion: 1,
  id: 'lab-3-vlans-roas',
  name: 'VLANs + router-on-a-stick',
  goal: 'PC1 in VLAN 10 must ping PC2 in VLAN 20 through R1 subinterfaces (router-on-a-stick).',
  description: 'Access ports, 802.1Q trunk, Gi0/0.10 and Gi0/0.20.',
  devices: [
    {
      kind: 'workstation',
      name: 'PC1',
      x: 80,
      y: 240,
      startup: ['ip addr add 10.0.10.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.10.1'],
    },
    {
      kind: 'workstation',
      name: 'PC2',
      x: 560,
      y: 240,
      startup: ['ip addr add 10.0.20.20/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.20.1'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 140,
      startup: [
        'enable', 'conf t', 'vlan 10', 'vlan 20',
        'int Gi0/1', 'switchport mode access', 'switchport access vlan 10', 'no shut',
        'int Gi0/2', 'switchport mode access', 'switchport access vlan 20', 'no shut',
        'int Gi0/8', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'no shut',
        'end',
      ],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 40,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'no shut',
        'int Gi0/0.10', 'encapsulation dot1Q 10', 'ip address 10.0.10.1 255.255.255.0',
        'int Gi0/0.20', 'encapsulation dot1Q 20', 'ip address 10.0.20.1 255.255.255.0',
        'end',
      ],
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/8' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.20.20', family: 'v4' }],
};

export const LAB_DHCP: LabJson = {
  schemaVersion: 1,
  id: 'lab-4-dhcpv4',
  name: 'DHCPv4',
  goal: 'PC1 gets an address from R1 via dhclient and can ping 192.168.1.1.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 220, startup: ['ip link set eth0 up'], post: ['dhclient eth0'] },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 120,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 520,
      y: 120,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut',
        'ip dhcp pool LAN',
        'network 192.168.1.0 255.255.255.0',
        'default-router 192.168.1.1',
        'dns-server 192.168.1.1',
        'end',
      ],
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

export const LAB_SLAAC: LabJson = {
  schemaVersion: 1,
  id: 'lab-5-slaac-ping6',
  name: 'Dual-stack SLAAC + ping6',
  goal: 'PC1 and PC2 must form SLAAC addresses from R1 RAs and ping6 each other.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 220, startup: ['ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 560, y: 220, startup: ['ip link set eth0 up'] },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 120,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'int Gi0/3', 'no shut', 'end'],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 40,
      startup: [
        'enable', 'conf t',
        'int Gi0/0',
        'ipv6 address 2001:db8:1::1/64',
        'ipv6 nd prefix 2001:db8:1::/64',
        'no ipv6 nd suppress-ra',
        'no shut',
        'end',
      ],
    },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/3' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: 'PC2', family: 'v6' }],
};

export const LAB_OSPF: LabJson = {
  schemaVersion: 1,
  id: 'lab-6-ospf-area0',
  name: 'OSPF area 0',
  goal: 'R1 and R2 become FULL neighbors in area 0 and PC1 can ping PC2 via OSPF-installed routes.',
  devices: [
    {
      kind: 'workstation',
      name: 'PC1',
      x: 60,
      y: 240,
      startup: ['ip addr add 10.0.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.1.1'],
    },
    {
      kind: 'workstation',
      name: 'PC2',
      x: 700,
      y: 240,
      startup: ['ip addr add 10.0.2.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.2.1'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 200,
      y: 160,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
    {
      kind: 'switch',
      name: 'SW2',
      x: 560,
      y: 160,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 280,
      y: 40,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 10.0.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.0', 'no shut',
        'router ospf 1', 'router-id 1.1.1.1',
        'network 10.0.1.0 0.0.0.255 area 0',
        'network 10.0.12.0 0.0.0.255 area 0',
        'end',
      ],
    },
    {
      kind: 'router',
      name: 'R2',
      x: 480,
      y: 40,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 10.0.2.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.0', 'no shut',
        'router ospf 1', 'router-id 2.2.2.2',
        'network 10.0.2.0 0.0.0.255 area 0',
        'network 10.0.12.0 0.0.0.255 area 0',
        'end',
      ],
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

export const LAB_WIFI: LabJson = {
  schemaVersion: 1,
  id: 'lab-7-wifi-dhcp-ping',
  name: 'Wi-Fi associate + DHCP + ping wired server',
  goal: 'Associate PC1 to CORP, get DHCP, ping the wired Linux server on VLAN 10.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 80, y: 280, startup: [], post: ['nmcli wifi connect CORP password netbench'] },
    {
      kind: 'server',
      name: 'SRV1',
      x: 620,
      y: 80,
      startup: ['ip addr add 10.0.10.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.10.1', 'systemctl start ssh'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 360,
      y: 120,
      startup: [
        'enable', 'conf t', 'vlan 10', 'vlan 20',
        'int Gi0/1', 'switchport mode access', 'switchport access vlan 10', 'no shut',
        'int Gi0/2', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'no shut',
        'int Gi0/3', 'switchport mode access', 'switchport access vlan 20', 'no shut',
        'end',
      ],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 360,
      y: 20,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'no shut',
        'int Gi0/0.10', 'encapsulation dot1Q 10', 'ip address 10.0.10.1 255.255.255.0',
        'int Gi0/0.20', 'encapsulation dot1Q 20', 'ip address 10.0.20.1 255.255.255.0',
        'ip dhcp pool WIFI',
        'network 10.0.20.0 255.255.255.0',
        'default-router 10.0.20.1',
        'end',
      ],
    },
    {
      kind: 'ap',
      name: 'AP1',
      x: 160,
      y: 160,
      startup: ['enable', 'conf t', 'ssid CORP', 'vlan 20', 'wpa2-psk netbench', 'channel 6', 'int Gi0/1', 'no shut', 'int wlan0', 'no shut', 'end'],
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

export const LAB_FIREWALL: LabJson = {
  schemaVersion: 1,
  id: 'lab-8-firewall-ssh',
  name: 'Firewall: block SSH from wifi VLAN, allow from wired jump host',
  goal: 'SSH from JUMP to SRV1 must work; SSH from WIFI-PC to SRV1 must be denied by the firewall.',
  devices: [
    {
      kind: 'workstation',
      name: 'JUMP',
      x: 40,
      y: 80,
      startup: ['ip addr add 10.0.10.20/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.10.1'],
    },
    {
      kind: 'workstation',
      name: 'WIFI-PC',
      x: 40,
      y: 280,
      startup: [],
      post: ['nmcli wifi connect CORP password netbench'],
    },
    {
      kind: 'server',
      name: 'SRV1',
      x: 640,
      y: 160,
      startup: ['ip addr add 10.0.30.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.30.1', 'systemctl start ssh'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 240,
      y: 160,
      startup: [
        'enable', 'conf t', 'vlan 10', 'vlan 20',
        'int Gi0/1', 'switchport mode access', 'switchport access vlan 10', 'no shut',
        'int Gi0/2', 'switchport mode access', 'switchport access vlan 20', 'no shut',
        'int Gi0/3', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'no shut',
        'end',
      ],
    },
    {
      kind: 'switch',
      name: 'SW2',
      x: 520,
      y: 160,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 240,
      y: 20,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'no shut',
        'int Gi0/0.10', 'encapsulation dot1Q 10', 'ip address 10.0.10.1 255.255.255.0',
        'int Gi0/0.20', 'encapsulation dot1Q 20', 'ip address 10.0.20.1 255.255.255.0',
        'int Gi0/1', 'ip address 10.0.99.1 255.255.255.0', 'no shut',
        'ip route 10.0.30.0 255.255.255.0 10.0.99.2',
        'ip dhcp pool WIFI', 'network 10.0.20.0 255.255.255.0', 'default-router 10.0.20.1',
        'end',
      ],
    },
    {
      kind: 'firewall',
      name: 'FW1',
      x: 400,
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
      y: 200,
      startup: ['enable', 'conf t', 'ssid CORP', 'vlan 20', 'wpa2-psk netbench', 'channel 6', 'int Gi0/1', 'no shut', 'int wlan0', 'no shut', 'end'],
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
};

export const BUILTIN_LABS: LabJson[] = [
  LAB_FIRST_PING,
  LAB_GATEWAY,
  LAB_ROAS,
  LAB_DHCP,
  LAB_SLAAC,
  LAB_OSPF,
  LAB_WIFI,
  LAB_FIREWALL,
];

export function labById(id: string): LabJson | undefined {
  return BUILTIN_LABS.find((l) => l.id === id);
}
