# VLANs

Access vs trunk, 802.1Q. Inter-VLAN uses router-on-a-stick: `interface Gi0/0.10` + `encapsulation dot1Q 10`.
The L2 switch SVI is management only — it does not route between VLANs.
If two PCs share an IP plan but different access VLANs, ping fails (isolation).
