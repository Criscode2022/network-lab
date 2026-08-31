import { defineEval } from 'eve/evals';
import { includes } from 'eve/evals/expect';

export default defineEval({
  description: 'Wifi client not associated → Eve tells them the nmcli connect line',
  async test(t) {
    await t.send('My laptop has no IP and cannot ping the wired server. SSID is CORP.');
    t.succeeded();
    t.check(t.reply, includes('nmcli wifi connect'));
  },
});
