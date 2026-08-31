import { defineEval } from 'eve/evals';
import { includes } from 'eve/evals/expect';

export default defineEval({
  description: 'Two PCs same VLAN, one iface shutdown → Eve names the shutdown and the no shutdown fix',
  async test(t) {
    await t.send('PC1 cannot ping PC2. SW1 Gi0/2 is shutdown. Why, and what is the fix?');
    t.succeeded();
    t.calledTool('get_lab_state');
    t.check(t.reply, includes('shutdown'));
    t.check(t.reply, includes('no shutdown'));
  },
});
