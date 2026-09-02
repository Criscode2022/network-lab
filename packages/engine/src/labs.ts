import { dualStackOfficeLab } from './build.ts';
import type { LabJson } from './types.ts';

const SW_TWO_PORTS = ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'];

export const LAB_PLUG_CABLE: LabJson = {
  schemaVersion: 1,
  id: 'lab-0a-plug-the-cable',
  name: 'Plug in the cable',
  goal: 'PC2 is not connected to anything. Cable PC2 to SW1 so that PC1 can ping 10.0.0.20.',
  description: 'Both PCs already have addresses. Only a cable is missing — use Cable, then tap PC2 and SW1.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: ['ip addr add 10.0.0.20/24 dev eth0', 'ip link set eth0 up'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: SW_TWO_PORTS },
  ],
  links: [{ a: 'PC1:eth0', b: 'SW1:Gi0/1' }],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
};

export const LAB_FIRST_ADDRESS: LabJson = {
  schemaVersion: 1,
  id: 'lab-0b-first-address',
  name: 'Give PC2 an address',
  goal: 'PC2 is cabled but has no IPv4 address. Give it 10.0.0.20/24 so that PC1 can ping it.',
  description: 'Select PC2 and use Add IP, or type: ip addr add 10.0.0.20/24 dev eth0',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: ['ip link set eth0 up'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: SW_TWO_PORTS },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
};

export const LAB_PORT_SHUTDOWN: LabJson = {
  schemaVersion: 1,
  id: 'lab-0c-port-shutdown',
  name: 'Turn the port on',
  goal: 'Everything is cabled and addressed, yet PC1 cannot ping PC2. One switch port is administratively down — find it and enable it.',
  description: 'Look at the port lights on the cards, or select SW1 and read the hints. On a Cisco switch: interface Gi0/2, no shutdown.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: ['ip addr add 10.0.0.20/24 dev eth0', 'ip link set eth0 up'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'shutdown', 'end'] },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.20', family: 'v4' }],
};

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

export const LAB_WRONG_MASK: LabJson = {
  schemaVersion: 1,
  id: 'lab-2b-wrong-mask',
  name: 'Find the fault: wrong subnet mask',
  goal: 'PC1 (10.0.0.10/24) must ping PC2 at 10.0.0.200. PC2 was configured with a /25 mask, so it believes PC1 is on another network and has no gateway to reach it.',
  description: 'Ping reaches PC2 but the reply never comes back. Fix PC2: ip addr del 10.0.0.200/25 dev eth0, then ip addr add 10.0.0.200/24 dev eth0.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 120, y: 260, startup: ['ip addr add 10.0.0.10/24 dev eth0', 'ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 520, y: 260, startup: ['ip addr add 10.0.0.200/25 dev eth0', 'ip link set eth0 up'] },
    { kind: 'switch', name: 'SW1', x: 320, y: 80, startup: SW_TWO_PORTS },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'PC2:eth0', b: 'SW1:Gi0/2' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '10.0.0.200', family: 'v4' }],
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
      y: 320,
      startup: ['ip addr add 10.0.10.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.10.1'],
    },
    {
      kind: 'workstation',
      name: 'PC2',
      x: 560,
      y: 320,
      startup: ['ip addr add 10.0.20.20/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.20.1'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 180,
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
    { kind: 'workstation', name: 'PC1', x: 80, y: 320, startup: ['ip link set eth0 up'] },
    { kind: 'workstation', name: 'PC2', x: 560, y: 320, startup: ['ip link set eth0 up'] },
    {
      kind: 'switch',
      name: 'SW1',
      x: 320,
      y: 180,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'int Gi0/3', 'no shut', 'end'],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 320,
      y: 20,
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
    { kind: 'workstation', name: 'PC1', x: 60, y: 360, startup: [], post: ['nmcli wifi connect CORP password netbench'] },
    {
      kind: 'server',
      name: 'SRV1',
      x: 620,
      y: 160,
      startup: ['ip addr add 10.0.10.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.10.1', 'systemctl start ssh'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 360,
      y: 160,
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
      y: 200,
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
      y: 500,
      startup: [],
      post: ['nmcli wifi connect CORP password netbench'],
    },
    {
      kind: 'server',
      name: 'SRV1',
      x: 680,
      y: 180,
      startup: ['ip addr add 10.0.30.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.30.1', 'systemctl start ssh'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 260,
      y: 180,
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
      y: 180,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int Gi0/2', 'no shut', 'end'],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 260,
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

export const LAB_STATIC_ROUTES: LabJson = {
  schemaVersion: 1,
  id: 'lab-9-static-routes',
  name: 'Two routers, static routes',
  goal: 'PC1 (10.1.1.10) must ping PC2 (10.2.2.10). Each router only knows its own networks: add a static route on R1 to 10.2.2.0/24 via 10.0.12.2 and on R2 to 10.1.1.0/24 via 10.0.12.1.',
  description: 'A /30 point-to-point link between two routers. Trace the ping to see which router drops it and why.',
  devices: [
    {
      kind: 'workstation',
      name: 'PC1',
      x: 60,
      y: 300,
      startup: ['ip addr add 10.1.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.1.1.1'],
    },
    {
      kind: 'workstation',
      name: 'PC2',
      x: 780,
      y: 300,
      startup: ['ip addr add 10.2.2.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.2.2.1'],
    },
    { kind: 'switch', name: 'SW1', x: 220, y: 300, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW2', x: 620, y: 300, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 220,
      y: 80,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
        'end',
      ],
    },
    {
      kind: 'router',
      name: 'R2',
      x: 620,
      y: 80,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 10.2.2.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
        'end',
      ],
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
};

export const LAB_OSPF_TRIANGLE: LabJson = {
  schemaVersion: 1,
  id: 'lab-10-ospf-three-routers',
  name: 'OSPF across three routers',
  goal: 'R1 and R2 already run OSPF area 0. R3 has the process but no network statements. Add them so R1–R3 and R2–R3 reach FULL and PC1 can ping PC2 (10.3.3.10).',
  description: 'A triangle of routers with a LAN on each end. On R3: router ospf 1, then network 10.0.13.0 0.0.0.3 area 0, network 10.0.23.0 0.0.0.3 area 0, network 10.3.3.0 0.0.0.255 area 0.',
  devices: [
    {
      kind: 'workstation',
      name: 'PC1',
      x: 60,
      y: 320,
      startup: ['ip addr add 10.1.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.1.1.1'],
    },
    {
      kind: 'workstation',
      name: 'PC2',
      x: 820,
      y: 320,
      startup: ['ip addr add 10.3.3.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.3.3.1'],
    },
    { kind: 'switch', name: 'SW1', x: 240, y: 320, startup: SW_TWO_PORTS },
    { kind: 'switch', name: 'SW2', x: 640, y: 320, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 240,
      y: 140,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 10.1.1.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.12.1 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.13.1 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 1.1.1.1',
        'network 10.1.1.0 0.0.0.255 area 0',
        'network 10.0.12.0 0.0.0.3 area 0',
        'network 10.0.13.0 0.0.0.3 area 0',
        'end',
      ],
    },
    {
      kind: 'router',
      name: 'R2',
      x: 440,
      y: 20,
      startup: [
        'enable', 'conf t',
        'int Gi0/1', 'ip address 10.0.12.2 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.23.1 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 2.2.2.2',
        'network 10.0.12.0 0.0.0.3 area 0',
        'network 10.0.23.0 0.0.0.3 area 0',
        'end',
      ],
    },
    {
      kind: 'router',
      name: 'R3',
      x: 640,
      y: 140,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 10.3.3.1 255.255.255.0', 'no shut',
        'int Gi0/1', 'ip address 10.0.23.2 255.255.255.252', 'no shut',
        'int Gi0/2', 'ip address 10.0.13.2 255.255.255.252', 'no shut',
        'router ospf 1', 'router-id 3.3.3.3',
        'end',
      ],
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
};

export const LAB_NAT: LabJson = {
  schemaVersion: 1,
  id: 'lab-11-nat-internet',
  name: 'Out to the Internet with NAT',
  goal: 'PC1 (192.168.1.10) must ping 8.8.8.8. R1 has a default route to the Internet but no NAT, so replies to the private address never come back.',
  description: 'On R1: ip access-list standard LAN, permit 192.168.1.0 0.0.0.255, then ip nat inside source list LAN interface Gi0/1 overload. Gi0/0 is already "ip nat inside" and Gi0/1 "ip nat outside".',
  devices: [
    {
      kind: 'workstation',
      name: 'PC1',
      x: 60,
      y: 260,
      startup: ['ip addr add 192.168.1.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 192.168.1.1'],
    },
    { kind: 'switch', name: 'SW1', x: 260, y: 260, startup: SW_TWO_PORTS },
    {
      kind: 'router',
      name: 'R1',
      x: 460,
      y: 260,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'ip address 192.168.1.1 255.255.255.0', 'ip nat inside', 'no shut',
        'int Gi0/1', 'ip address 203.0.113.2 255.255.255.0', 'ip nat outside', 'no shut',
        'ip route 0.0.0.0 0.0.0.0 203.0.113.1',
        'end',
      ],
    },
    { kind: 'cloud', name: 'INET', x: 700, y: 260, startup: [] },
  ],
  links: [
    { a: 'PC1:eth0', b: 'SW1:Gi0/1' },
    { a: 'R1:Gi0/0', b: 'SW1:Gi0/2' },
    { a: 'R1:Gi0/1', b: 'INET:eth0' },
  ],
  checks: [{ type: 'ping', src: 'PC1', dst: '8.8.8.8', family: 'v4' }],
};

export const LAB_WLC: LabJson = {
  schemaVersion: 1,
  id: 'lab-12-wlc-capwap',
  name: 'Wi-Fi with a controller (WLC)',
  goal: 'AP1 has no SSID of its own: it must join the controller (capwap controller 10.0.10.5) to receive the CORP WLAN. Then PC1 associates, gets DHCP and pings SRV1 (10.0.10.10).',
  description: 'The WLC already defines WLAN CORP on VLAN 20 with PSK netbench. Configure the AP, then on PC1: nmcli wifi connect CORP password netbench.',
  devices: [
    { kind: 'workstation', name: 'PC1', x: 60, y: 320, startup: [] },
    {
      kind: 'server',
      name: 'SRV1',
      x: 740,
      y: 100,
      startup: ['ip addr add 10.0.10.10/24 dev eth0', 'ip link set eth0 up', 'ip route add default via 10.0.10.1', 'systemctl start ssh'],
    },
    {
      kind: 'switch',
      name: 'SW1',
      x: 440,
      y: 200,
      startup: [
        'enable', 'conf t', 'vlan 10', 'vlan 20',
        'int Gi0/1', 'switchport mode access', 'switchport access vlan 10', 'no shut',
        'int Gi0/2', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20', 'no shut',
        'int Gi0/3', 'switchport mode access', 'switchport access vlan 20', 'no shut',
        'int Gi0/4', 'switchport mode access', 'switchport access vlan 10', 'no shut',
        'end',
      ],
    },
    {
      kind: 'router',
      name: 'R1',
      x: 440,
      y: 20,
      startup: [
        'enable', 'conf t',
        'int Gi0/0', 'no shut',
        'int Gi0/0.10', 'encapsulation dot1Q 10', 'ip address 10.0.10.1 255.255.255.0',
        'int Gi0/0.20', 'encapsulation dot1Q 20', 'ip address 10.0.20.1 255.255.255.0',
        'ip dhcp pool WIFI', 'network 10.0.20.0 255.255.255.0', 'default-router 10.0.20.1',
        'end',
      ],
    },
    {
      kind: 'wlc',
      name: 'WLC1',
      x: 740,
      y: 300,
      startup: [
        'enable', 'conf t',
        'int Gi0/1', 'ip address 10.0.10.5 255.255.255.0', 'no shut',
        'wlan create CORP vlan 20', 'wpa2 psk netbench',
        'end',
      ],
    },
    {
      kind: 'ap',
      name: 'AP1',
      x: 240,
      y: 200,
      startup: ['enable', 'conf t', 'int Gi0/1', 'no shut', 'int wlan0', 'no shut', 'end'],
    },
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
};

/** Capstone: the builder's dual-stack office, shipped as a study lab (everything works — read it, break it, fix it). */
export const LAB_CAPSTONE: LabJson = (() => {
  const lab = dualStackOfficeLab();
  return {
    ...lab,
    id: 'lab-13-dual-stack-office',
    name: 'Capstone: dual-stack office',
    goal: `${lab.goal} Read every device's running-config, then break one thing and repair it with Check.`,
    description: 'VLAN 10 wired + VLAN 20 Wi-Fi behind one router-on-a-stick, IPv4 + IPv6 (SLAAC), DHCP for Wi-Fi, SSH on the server.',
    devices: lab.devices.map((d) => ({ ...d, x: d.x * 1.3 + 40, y: d.y * 1.3 + 20 })),
  };
})();

export const BUILTIN_LABS: LabJson[] = [
  LAB_PLUG_CABLE,
  LAB_FIRST_ADDRESS,
  LAB_PORT_SHUTDOWN,
  LAB_FIRST_PING,
  LAB_GATEWAY,
  LAB_WRONG_MASK,
  LAB_ROAS,
  LAB_DHCP,
  LAB_SLAAC,
  LAB_OSPF,
  LAB_WIFI,
  LAB_FIREWALL,
  LAB_STATIC_ROUTES,
  LAB_OSPF_TRIANGLE,
  LAB_NAT,
  LAB_WLC,
  LAB_CAPSTONE,
];

export function labById(id: string): LabJson | undefined {
  return BUILTIN_LABS.find((l) => l.id === id);
}
