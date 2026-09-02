import { defineAgent } from 'eve';
import { modelConfig } from '../../lib/model.ts';

export default defineAgent({
  description:
    'Smallest change that makes the current goal / check pass. Typical junior faults: shutdown, access vs trunk, missing SVI, wrong or missing gateway, wrong mask, missing static route or OSPF network, wifi not associated, ACL direction, NAT, IPv6 RA off, overlapping subnets.',
  ...modelConfig,
  model: modelConfig.model,
});
