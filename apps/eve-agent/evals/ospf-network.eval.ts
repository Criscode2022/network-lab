import { defineEval } from 'eve/evals';
import { includes } from 'eve/evals/expect';

export default defineEval({
  description: 'OSPF missing network statement → Eve adds the correct network/area 0',
  async test(t) {
    await t.send('OSPF neighbors are not FULL. I think a network statement is missing under router ospf 1.');
    t.succeeded();
    t.check(t.reply, includes('network'));
    t.check(t.reply, includes('area 0'));
  },
});
