# VLANs

Access vs trunk, 802.1Q. An unmanaged switch has no VLAN configuration and transparently bridges one LAN.
Inter-VLAN uses either router-on-a-stick (`interface Gi0/0.10` + `encapsulation dot1Q 10`) or a `multilayer` switch with addressed SVIs and global `ip routing`.
A `managed-l2` switch SVI is management only — it does not route between VLANs.
On a multilayer switch, physical interfaces remain switchports unless `no switchport` converts one to a routed port.
If two PCs share an IP plan but different access VLANs, ping fails (isolation).
