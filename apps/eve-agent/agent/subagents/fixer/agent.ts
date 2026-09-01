import { defineAgent } from 'eve';

export default defineAgent({
  description: 'Smallest change that makes the current goal / check pass. Typical junior faults: shutdown, access vs trunk, missing SVI, wrong gateway, missing OSPF network, wifi not associated, ACL direction, NAT, IPv6 RA off, overlapping subnets.',
  model: 'minimax/minimax-m3',
});
