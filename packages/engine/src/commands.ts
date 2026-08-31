import type { DeviceKind } from './types.ts';

export interface CmdHelp {
  cmd: string;
  help: string;
}

export const COMMANDS: Record<DeviceKind, CmdHelp[]> = {
  workstation: [
    { cmd: 'ip addr [add ADDR/P dev IF]', help: 'Show or add IPv4/IPv6 address' },
    { cmd: 'ip link set IF up|down', help: 'Admin state' },
    { cmd: 'ip route [add default via GW]', help: 'Show or add IPv4/IPv6 route' },
    { cmd: 'ping [-c N] HOST', help: 'ICMP echo (default 4 packets in this lab)' },
    { cmd: 'ping6 [-c N] HOST', help: 'ICMPv6 echo' },
    { cmd: 'traceroute HOST', help: 'IPv4 traceroute (simulated)' },
    { cmd: 'traceroute6 HOST', help: 'IPv6 traceroute (simulated)' },
    { cmd: 'ss', help: 'Show sockets' },
    { cmd: 'hostname [NAME]', help: 'Get/set hostname' },
    { cmd: 'cat /etc/hosts', help: 'Show hosts file' },
    { cmd: 'systemctl start ssh', help: 'Enable SSH login shell on port 22' },
    { cmd: 'ssh user@HOST', help: 'SSH path+port 22 then remote shell (not real crypto)' },
    { cmd: 'dhclient [IF]', help: 'DHCPv4 client' },
    { cmd: 'dig NAME', help: 'DNS A/AAAA lookup' },
    { cmd: 'nslookup NAME', help: 'DNS lookup' },
    { cmd: 'resolvectl', help: 'Show resolver' },
    { cmd: 'iw dev wlan0 link', help: 'Wi-Fi association' },
    { cmd: 'nmcli wifi connect SSID password PSK', help: 'Associate then (usually) DHCP' },
    { cmd: 'tcpdump -c 10', help: 'Last frames on this node (simulated)' },
    { cmd: 'reboot', help: 'Reload startup-config' },
    { cmd: 'help', help: 'This cheat sheet' },
    { cmd: 'exit', help: 'Leave SSH or ignore' },
  ],
  server: [],
  switch: [
    { cmd: 'enable', help: 'Privileged EXEC' },
    { cmd: 'configure terminal', help: 'Global config' },
    { cmd: 'hostname NAME', help: 'Set hostname' },
    { cmd: 'vlan N', help: 'Create VLAN' },
    { cmd: 'interface Gi0/N | VlanN', help: 'Interface config' },
    { cmd: 'switchport mode access|trunk', help: 'L2 mode' },
    { cmd: 'switchport access vlan N', help: 'Access VLAN' },
    { cmd: 'switchport trunk allowed vlan ...', help: 'Trunk allow list' },
    { cmd: 'ip address A.B.C.D MASK', help: 'SVI IPv4 (management, no inter-VLAN routing)' },
    { cmd: 'ipv6 address CIDR', help: 'SVI IPv6' },
    { cmd: 'ip default-gateway A.B.C.D', help: 'Management default gateway' },
    { cmd: 'no shutdown / shutdown', help: 'Admin up/down' },
    { cmd: 'show run | vlan | mac | int | trunk', help: 'Show commands' },
    { cmd: 'write', help: 'Copy running to startup' },
    { cmd: 'end / exit', help: 'Leave config mode' },
    { cmd: 'help', help: 'This cheat sheet' },
  ],
  router: [
    { cmd: 'enable / conf t / hostname / write / end', help: 'Modes' },
    { cmd: 'interface Gi0/N[.VLAN]', help: 'Routed iface or 802.1Q subif' },
    { cmd: 'encapsulation dot1Q N', help: 'ROAS subinterface' },
    { cmd: 'ip address / ipv6 address / no shutdown', help: 'Addressing' },
    { cmd: 'ipv6 nd prefix CIDR', help: 'RA prefix (SLAAC)' },
    { cmd: 'ipv6 nd suppress-ra / no ipv6 nd suppress-ra', help: 'RA enable' },
    { cmd: 'ip route / ipv6 route', help: 'Static routes' },
    { cmd: 'router ospf 1', help: 'OSPFv2 process' },
    { cmd: 'router-id A.B.C.D', help: 'OSPF router ID' },
    { cmd: 'network A.B.C.D WILD area 0', help: 'Enable OSPF on matching ifaces, area 0 only' },
    { cmd: 'ip nat inside|outside', help: 'NAT domain' },
    { cmd: 'ip access-list standard NAME', help: 'Simple ACL' },
    { cmd: 'permit/deny ...', help: 'ACL entry' },
    { cmd: 'ip nat inside source list NAME interface IF overload', help: 'PAT to WAN' },
    { cmd: 'ip dhcp pool NAME', help: 'DHCPv4 pool' },
    { cmd: 'network / default-router / dns-server', help: 'Pool options' },
    { cmd: 'ipv6 access-list NAME', help: 'Simple IPv6 ACL' },
    { cmd: 'show run | ip route | ipv6 route | ip ospf neighbor | ip ospf database', help: 'Show' },
    { cmd: 'help', help: 'This cheat sheet' },
  ],
  firewall: [
    { cmd: 'nft add rule ...', help: 'nftables-lite: allow/deny tcp/udp/icmp v4+v6' },
    { cmd: 'zone lan|wan|wifi IF', help: 'Bind interface to zone' },
    { cmd: 'policy SRC DST allow|deny [tcp PORT]', help: 'Inter-zone policy' },
    { cmd: 'masquerade wan', help: 'IPv4 SNAT to WAN' },
    { cmd: 'show run | show rules', help: 'Show' },
    { cmd: 'ip addr / ping / help', help: 'Host-like addressing also works' },
  ],
  ap: [
    { cmd: 'ssid NAME', help: 'Create/select SSID' },
    { cmd: 'vlan N', help: 'SSID → VLAN (one SSID, one VLAN)' },
    { cmd: 'wpa2-psk PSK', help: 'WPA2-PSK (no 802.1X)' },
    { cmd: 'channel N', help: 'Cosmetic except same-SSID/same-channel = one BSS' },
    { cmd: 'capwap controller A.B.C.D', help: 'Join thin WLC (control only, local-breakout data)' },
    { cmd: 'no shutdown', help: 'Enable radio/uplink' },
    { cmd: 'show ssid | show interface', help: 'Show' },
    { cmd: 'help', help: 'This cheat sheet' },
  ],
  wlc: [
    { cmd: 'wlan create SSID vlan N', help: 'WLAN on VLAN' },
    { cmd: 'wpa2 psk PSK', help: 'PSK only' },
    { cmd: 'show ap summary | show wlan', help: 'Joined APs and WLANs' },
    { cmd: 'help', help: 'This cheat sheet' },
  ],
  cloud: [
    { cmd: 'show run', help: 'Internet stub addressing' },
    { cmd: 'ping HOST', help: 'ICMP' },
    { cmd: 'help', help: 'This cheat sheet' },
  ],
};

COMMANDS.server = COMMANDS.workstation;

export function listCommands(kind: DeviceKind): CmdHelp[] {
  return COMMANDS[kind] ?? [];
}

export function helpText(kind: DeviceKind): string {
  const rows = listCommands(kind);
  return rows.map((r) => `  ${r.cmd.padEnd(42)} ${r.help}`).join('\n');
}
