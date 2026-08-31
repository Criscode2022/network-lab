# Firewall / ACL

Stateful nftables-lite, zones lan/wan/wifi, allow/deny v4+v6, masquerade wan.
ACL direction and source prefix matter. Established return traffic is allowed after the first pass.
IPv4 SNAT LAN → Internet uses `ip nat inside/outside` + overload or `masquerade wan`.
