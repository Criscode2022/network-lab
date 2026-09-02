import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { mutationApproval } from '../lib/approval.ts';
import { guardCommands, guardLabId } from '../lib/guards.ts';
import { mintConfirm, nest, newIdempotencyKey } from '../lib/nest.ts';

export default defineTool({
  description:
    'Run CLI commands on one node as if typed (Linux: ip addr add/del, ip route add/del/replace, nmcli, dhclient; Cisco: enable, conf t, interface …, no shutdown, ip route / no ip route, end). Stops at the first rejected line and returns each output. labId is the labSessionId UUID from context; deviceId is the device id or name. Do not pass a confirmToken. Runs immediately.',
  approval: mutationApproval<{ labId: string; deviceId: string; commands: string[] }>({
    dangerous: (i) => (i.commands.some((c) => /^shutdown$/i.test(c.trim())) ? 'shuts an interface down' : undefined),
  }),
  inputSchema: z.object({
    labId: z.string(),
    deviceId: z.string().min(1),
    commands: z.array(z.string()).min(1).max(60),
  }),
  async execute(input) {
    const labId = guardLabId(input.labId);
    const commands = guardCommands(input.commands);
    const confirmToken = await mintConfirm(labId, 'apply_device_config');
    return nest(
      '/eve/tools/apply_device_config',
      { labId, deviceId: input.deviceId.trim(), commands, confirmToken },
      { idempotencyKey: newIdempotencyKey('apply_device_config') },
    );
  },
});
