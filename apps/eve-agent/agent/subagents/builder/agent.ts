import { defineAgent } from 'eve';
import { modelConfig } from '../../lib/model.ts';

export default defineAgent({
  description:
    'Build a lab from a request: a quick sentence for small labs, or full lab JSON (devices with startup config, cables, checks) for anything specific or large — up to 40 devices, several VLANs/routers, OSPF area 0, NAT, firewall, Wi-Fi/WLC. Optional broken-on-purpose fault.',
  ...modelConfig,
  model: modelConfig.model,
});
