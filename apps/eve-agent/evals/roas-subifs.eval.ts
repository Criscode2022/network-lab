import { defineEval } from 'eve/evals';
import { includes } from 'eve/evals/expect';

export default defineEval({
  description: 'Inter-VLAN with no router subinterface → Eve says router-on-a-stick and builds the subifs',
  async test(t) {
    await t.send('PC1 VLAN 10 cannot ping PC2 VLAN 20. R1 has no subinterfaces. Fix it.');
    t.succeeded();
    t.check(t.reply, includes('router-on-a-stick'));
  },
});
