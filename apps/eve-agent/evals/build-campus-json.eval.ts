import { defineEval } from 'eve/evals';

export default defineEval({
  description: 'A larger, specific request goes through build_lab with full lab JSON: 3 VLANs, 8 PCs, two switches, ROAS router, server',
  async test(t) {
    await t.send(
      'Build a campus lab: VLAN 10 sales with 4 PCs, VLAN 20 engineering with 4 PCs, VLAN 30 with a Linux server, two switches trunked together, one router-on-a-stick as the gateway for every VLAN. Everything working; PC1 must ping the server.',
    );
    t.succeeded();
    t.calledTool('build_lab');
  },
});
