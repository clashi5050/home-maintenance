import { api, app, esc, ctx, toast } from '../lib.js';

export async function render() {
  const [s, assistant] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/assistant')]);
  const feed = `${location.origin}/api/calendar.ics`;

  app.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p class="sub">Push reminders, calendar, backups and the assistant.</p></div></div>
    <div class="grid">
      <section class="card">
        <h2>Push notifications</h2>
        <p class="muted small" style="margin-top:0">Reminders are sent through <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a>. Install the free ntfy app on your phone, subscribe to your topic, and you'll get one daily digest when something is coming up, due, overdue, or a warranty or appliance is nearing its end.</p>
        <form class="settings-form" id="settings-form">
          <label class="check"><input type="checkbox" name="notifications_enabled"${s.notifications_enabled === 'true' ? ' checked' : ''}> Send reminders</label>
          <div class="field"><label for="s-topic">ntfy topic</label><input id="s-topic" name="ntfy_topic" value="${esc(s.ntfy_topic)}" placeholder="e.g. smith-house-7x2k9" autocomplete="off" autocapitalize="off"><span class="hint">Anyone who knows the topic name can read it on public ntfy.sh, so make it long and hard to guess.</span></div>
          <div class="field"><label for="s-url">ntfy server</label><input id="s-url" name="ntfy_url" value="${esc(s.ntfy_url)}" inputmode="url"><span class="hint">Leave as https://ntfy.sh, or point at your own ntfy server.</span></div>
          <div class="field"><label for="s-token">Access token (optional)</label><input id="s-token" name="ntfy_token" type="password" placeholder="${s.ntfy_token_set ? 'Saved. Type to replace, or leave blank to keep' : 'Only for protected topics'}" autocomplete="new-password"></div>
          <div class="field"><label for="s-app">This app's address (optional)</label><input id="s-app" name="app_url" value="${esc(s.app_url)}" inputmode="url" placeholder="http://192.168.1.50:8085"><span class="hint">When set, tapping a notification opens the app.</span></div>
          <div class="fields">
            <div class="field"><label for="s-time">Send at (${esc(s.timezone)})</label><input id="s-time" name="notify_time" type="time" value="${esc(s.notify_time)}"></div>
            <div class="field"><label for="s-lead">Maintenance heads-up (days)</label><input id="s-lead" name="lead_days" type="number" min="0" max="365" value="${esc(s.lead_days)}"></div>
            <div class="field"><label for="s-wlead">Warranty heads-up (days)</label><input id="s-wlead" name="warranty_lead_days" type="number" min="0" max="730" value="${esc(s.warranty_lead_days)}"></div>
          </div>
          <div class="actions"><button class="btn primary" type="submit">Save settings</button><button class="btn" type="button" data-action="test-notify">Send test</button><button class="btn" type="button" data-action="run-notify">Check now</button></div>
        </form>
      </section>
      <section class="card">
        <h2>Calendar</h2>
        <p class="muted small" style="margin-top:0">Subscribe to this feed to see due dates, warranty ends and equipment lifespans in your phone's calendar.</p>
        <div class="copy-row"><input readonly value="${esc(feed)}" aria-label="Calendar feed address"><button class="btn sm" data-action="copy-feed" data-feed="${esc(feed)}">Copy</button><a class="btn sm" href="${esc(feed.replace(/^https?:/, 'webcal:'))}">Subscribe</a></div>
      </section>
      <section class="card">
        <h2>Assistant</h2>
        <p class="muted small" style="margin-top:0">${assistant.enabled
    ? `On. Answers come from ${esc(assistant.model)} through the Anthropic API. Change the model with the ASSISTANT_MODEL setting.`
    : 'Off. Add an ANTHROPIC_API_KEY to the app\'s environment to turn it on. See the Assistant page for details.'}</p>
      </section>
      <section class="card">
        <h2>Backup and export</h2>
        <p class="muted small" style="margin-top:0">Everything, including uploaded documents, lives in the container's data volume. Include that volume in your NAS backups. These downloads are handy copies for other purposes.</p>
        <div class="actions"><a class="btn" href="/api/export" download>Data backup (JSON)</a><a class="btn" href="/api/history.csv" download>Home log (CSV)</a><a class="btn" href="#/report">Home report</a></div>
      </section>
    </div>`;

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const body = {
      notifications_enabled: f.notifications_enabled.checked ? 'true' : 'false',
      ntfy_topic: f.ntfy_topic.value, ntfy_url: f.ntfy_url.value, app_url: f.app_url.value, notify_time: f.notify_time.value,
      lead_days: f.lead_days.value, warranty_lead_days: f.warranty_lead_days.value,
    };
    if (f.ntfy_token.value) body.ntfy_token = f.ntfy_token.value;
    try { await api('PUT', '/api/settings', body); toast('Settings saved'); ctx.render(); } catch (err) { toast(err.message, true); }
  });
}

export const actions = {
  'test-notify': async () => { await api('POST', '/api/notify/test'); toast('Test sent. Check your phone.'); },
  'run-notify': async () => {
    const r = await api('POST', '/api/notify/run');
    toast(r.sent ? `Sent ${r.sent} reminder${r.sent === 1 ? '' : 's'}` : r.reason);
  },
};
