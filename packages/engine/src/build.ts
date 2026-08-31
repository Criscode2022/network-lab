import type { LabJson } from './types.ts';

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
