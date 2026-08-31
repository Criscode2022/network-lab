import { defineEval } from 'eve/evals';

export default defineEval({
  description: 'Build a dual-stack office: SW, R, AP, server, 2 PCs → valid lab JSON, pings pass after apply',
  async test(t) {
    await t.send('Build a dual-stack office: SW, R, AP, server, 2 PCs');
    t.succeeded();
    t.calledTool('build_lab');
  },
});
