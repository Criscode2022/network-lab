# In-app command cheat sheet

Type `help` on any node. Unknown commands fail honestly.

## Linux (workstation / server)

`ip addr`, `ip addr add CIDR dev IF`, `ip link set IF up|down`, `ip route`, `ping [-c N]`, `ping6`, `traceroute`, `traceroute6`, `ss`, `hostname`, `cat /etc/hosts`, `systemctl start ssh`, `ssh user@HOST`, `dhclient`, `dig`, `nslookup`, `resolvectl`, `iw`, `nmcli wifi connect SSID password PSK`, `tcpdump -c 10`, `reboot`, `help`, `exit`.

## Switch

`enable`, `conf t`, `vlan N`, `interface Gi0/N`, `switchport mode access|trunk`, `switchport access vlan N`, `ip address` (SVI, management only), `ip default-gateway`, `no shutdown`, `show run|vlan|mac|int|trunk`, `write`.

## Router

Addressing, `encapsulation dot1Q`, RA (`ipv6 nd prefix`, `no ipv6 nd suppress-ra`), static `ip route` / `ipv6 route`, `router ospf 1` + `network … area 0` + `router-id`, NAT overload + ACL, `ip dhcp pool`, `ipv6 access-list`, `show ip route|ipv6 route|ip ospf neighbor|ip ospf database`.

## AP / WLC / firewall / cloud

AP: `ssid`, `vlan`, `wpa2-psk`, `channel`, `capwap controller`, `no shutdown`.
WLC: `wlan create SSID vlan N`, `wpa2 psk`, `show ap summary`, `show wlan`.
Firewall: `nft add rule …`, `zone`, `policy`, `masquerade wan`.
Cloud: internet stub, answers 8.8.8.8.

Not in the product: BGP, MPLS, VXLAN, 802.1X, NSSA, virtual-links.
