# Dual-stack in this engine

IPv4 still dominates. IPv6 is SLAAC + RA RDNSS, static routes, ping6/traceroute6.
No OSPFv3 unless it is the same area 0 process; otherwise IPv6 is static + RA.
DAD/conflict warnings exist. Missing gateway is the most common v4 fault.
Hosts need `ip route add default via` or RA default.
