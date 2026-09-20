// Ask about a problem in words or with a photo. Optional: needs an Anthropic API key on the server.
import { $, api, app, ctx, downscaleImage, esc, pill, toast } from '../lib.js';

let convo = []; // messages as the API wants them: { role, text, image? }
let transcript = []; // what is shown on screen
let pendingImage = null;
let busy = false;

const URGENCY = { emergency: ['overdue', 'Emergency'], soon: ['due', 'Deal with it soon'], routine: ['ok', 'Routine'] };
const APPROACH = { diy: 'Fine to do yourself', call_a_pro: 'Call a professional', either: 'DIY or professional' };

function disabledHtml(status) {
  return `<div class="page-head"><div><h1>Assistant</h1><p class="sub">Describe a problem or snap a photo and get clear next steps.</p></div></div>
    <section class="card callout">
      <h2>The assistant is turned off</h2>
      <p>It is optional. It uses Claude (${esc(status.model)}) through the Anthropic API, so it needs an API key from your own Anthropic account.</p>
      <ol>
        <li>Create an API key in the Anthropic Console.</li>
        <li>Add it as <code>ANTHROPIC_API_KEY</code> in the app's environment: the <code>environment</code> section of the compose file, or a Kubernetes secret.</li>
        <li>Restart the container.</li>
      </ol>
      <p class="small muted">When it is on, each question sends your text, any photo, and a short summary of your home (year built, features, equipment and ages) to the Anthropic API. Your address, insurance details and purchase price are never sent. Usage is billed to your Anthropic account.</p>
    </section>`;
}

function replyHtml(item, index) {
  const r = item.reply;
  const [tone, label] = URGENCY[r.urgency] ?? URGENCY.routine;
  const listOf = (title, list, ordered = false) => (list.length ? `<h4>${title}</h4><${ordered ? 'ol' : 'ul'} class="steps">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : '');
  return `<div class="bubble assistant">
    <div class="reply-head">${pill(tone, label)}<span class="muted small">${esc(APPROACH[r.approach] ?? '')}${r.pro_trade ? ` · ${esc(r.pro_trade)}` : ''}</span></div>
    <p class="reply-summary">${esc(r.summary)}</p>
    ${r.safety ? `<div class="safety"><strong>Safety:</strong> ${esc(r.safety)}</div>` : ''}
    ${listOf('Likely causes', r.likely_causes)}
    ${listOf('What to do', r.steps, true)}
    ${r.task_title && r.task_kind !== 'none' ? `<div class="actions"><button class="btn sm primary" data-action="assistant-add" data-index="${index}">Add "${esc(r.task_title)}" to my list</button></div>` : ''}
    <div class="small muted reply-foot">Advice only. Check anything safety-related with a qualified professional.${item.fallback ? ' Answered by a fallback model.' : ''}</div>
  </div>`;
}

function draw() {
  const chat = $('#chat');
  if (!chat) return;
  chat.innerHTML = transcript.length
    ? transcript.map((t, i) => {
      if (t.role === 'user') return `<div class="bubble user">${t.preview ? `<img src="${esc(t.preview)}" alt="Attached photo">` : ''}${t.text ? `<p>${esc(t.text)}</p>` : ''}</div>`;
      if (t.role === 'error') return `<div class="bubble error">${esc(t.text)}</div>`;
      return replyHtml(t, i);
    }).join('') + (busy ? '<div class="bubble assistant thinking">Thinking…</div>' : '')
    : `<div class="empty">Try: "The toilet keeps running", "There's a damp spot on the ceiling below the bathroom", or attach a photo of whatever is worrying you.</div>`;
  chat.scrollTop = chat.scrollHeight;
  $('#photo-preview').innerHTML = pendingImage
    ? `<span class="chip-photo"><img src="${esc(pendingImage.preview)}" alt="Photo to send"><button type="button" class="link-btn" data-action="assistant-unphoto">Remove</button></span>` : '';
}

export async function render() {
  const status = await api('GET', '/api/assistant');
  if (!status.enabled) { app.innerHTML = disabledHtml(status); return; }

  app.innerHTML = `
    <div class="page-head"><div><h1>Assistant</h1><p class="sub">Describe a problem or attach a photo. It knows your home's details and equipment.</p></div>
      <button class="btn" data-action="assistant-reset">New conversation</button></div>
    <p class="small muted" style="margin:0 0 12px">Your message, any photo, and a short summary of your home are sent to the Anthropic API (${esc(status.model)}). Your address and insurance details are not.</p>
    <section class="card chat-card">
      <div id="chat" class="chat" aria-live="polite"></div>
      <div id="photo-preview"></div>
      <form id="chat-form" class="composer">
        <textarea id="chat-text" rows="2" placeholder="What's going on?" aria-label="Describe the problem" maxlength="4000"></textarea>
        <div class="composer-row">
          <label class="btn sm" for="chat-photo">Attach photo</label>
          <input id="chat-photo" type="file" accept="image/*" hidden>
          <button class="btn primary" type="submit" id="chat-send">Send</button>
        </div>
      </form>
    </section>`;
  draw();

  $('#chat-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { pendingImage = await downscaleImage(file); draw(); } catch (err) { toast(err.message, true); }
  });

  const text = $('#chat-text');
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#chat-form').requestSubmit(); });
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = text.value.trim();
    if (busy || (!message && !pendingImage)) return;

    const image = pendingImage;
    convo.push({ role: 'user', text: message, ...(image ? { image: { media_type: image.media_type, data: image.data } } : {}) });
    transcript.push({ role: 'user', text: message, preview: image?.preview });
    text.value = '';
    pendingImage = null;
    busy = true;
    $('#chat-send').disabled = true;
    draw();

    try {
      const res = await api('POST', '/api/assistant', { messages: convo });
      convo.push({ role: 'assistant', text: res.raw });
      transcript.push({ role: 'assistant', reply: res.reply, fallback: res.fallback_used });
    } catch (err) {
      convo.pop(); // let them retry the same message
      transcript.push({ role: 'error', text: err.message });
      text.value = message;
      pendingImage = image;
    } finally {
      busy = false;
      const send = $('#chat-send');
      if (send) send.disabled = false;
      draw();
    }
  });
}

export const actions = {
  'assistant-reset': () => { convo = []; transcript = []; pendingImage = null; ctx.render(); },
  'assistant-unphoto': () => { pendingImage = null; draw(); },
  'assistant-add': async (_id, data) => {
    const r = transcript[Number(data.index)].reply;
    await api('POST', '/api/tasks', {
      kind: r.task_kind === 'need' ? 'need' : 'project',
      title: r.task_title,
      notes: r.task_notes || r.summary,
      priority: r.urgency === 'emergency' ? 'high' : r.urgency === 'soon' ? 'medium' : 'low',
      status: 'idea',
    });
    toast(`Added to ${r.task_kind === 'need' ? 'Needs' : 'Projects'}`);
  },
};

