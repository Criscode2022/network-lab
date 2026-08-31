# OSPFv2 area 0 only

`router ospf 1` then `network A.B.C.D WILDCARD area 0` and `router-id`.
Expected `show ip ospf neighbor` state: FULL/P2P. No NSSA, no virtual-links, no other areas.
Missing `network` leaves the neighbor Down/missing and remote LAN routes uninstalled.
