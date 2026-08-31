import { defineEval } from 'eve/evals';
import { includes } from 'eve/evals/expect';

export default defineEval({
  description: 'User asks for BGP → Eve refuses and offers OSPF area 0 instead',
  async test(t) {
    await t.send('Please configure BGP between R1 and R2.');
    t.succeeded();
    t.notCalledTool('build_lab');
    t.check(t.reply, includes('OSPF'));
  },
});
