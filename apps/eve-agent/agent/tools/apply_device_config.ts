import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { mutationApproval } from '../lib/approval.ts';
import { mintConfirm, nest } from '../lib/nest.ts';

export default defineTool({
  description:
    'Run CLI commands on one node as if typed (Linux: ip addr add/del, ip route add/del/replace, nmcli, dhclient; Cisco: enable, conf t, interface …, no shutdown, ip route / no ip route, end). Stops at the first rejected line and returns each output. labId is the labSessionId UUID from context; deviceId is the device id or name. Do not pass a confirmToken. Runs immediately.',
  approval: mutationApproval(),
  inputSchema: z.object({
    labId: z.string(),
    deviceId: z.string(),
    commands: z.array(z.string()).min(1).max(60),
  }),
  async execute(input) {
    const confirmToken = await mintConfirm(input.labId, 'apply_device_config');
    return nest('/eve/tools/apply_device_config', {
      labId: input.labId,
      deviceId: input.deviceId,
      commands: input.commands,
      confirmToken,
    });
  },
});
