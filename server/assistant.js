// "Ask about a problem": describe an issue in words or with a photo and get next steps.
// Optional. It only works when ANTHROPIC_API_KEY is set, and it sends the question, any
// photos, and a short summary of the home profile and equipment to the Anthropic API.
import { HOME_FEATURES, APPLIANCE_CATEGORIES } from './catalog.js';
import { getProfile, listAppliances, listMaintenance } from './resources.js';
import { HttpError } from './validate.js';

export const DEFAULT_MODEL = 'claude-opus-5';
const model = () => process.env.ASSISTANT_MODEL || DEFAULT_MODEL;
const hasCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export const assistantStatus = () => ({ enabled: hasCredentials(), model: model() });

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_MESSAGES = 12;
const MAX_IMAGES = 3;
const MAX_IMAGE_BASE64_CHARS = 7_000_000; // about 5 MB decoded, the API's per-image limit
const MAX_USER_CHARS = 4000;
const MAX_ASSISTANT_CHARS = 20_000;

export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two sentences: what is most likely going on and what to do first.' },
    urgency: { type: 'string', enum: ['emergency', 'soon', 'routine'] },
    approach: { type: 'string', enum: ['diy', 'call_a_pro', 'either'] },
    pro_trade: { type: 'string', description: 'The trade to call, such as plumber or HVAC technician. Empty if DIY is fine.' },
    likely_causes: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' }, description: 'Concrete next steps in order.' },
    safety: { type: 'string', description: 'Any safety warning. Empty if none applies.' },
    task_title: { type: 'string', description: 'A short title if this is worth tracking, otherwise empty.' },
    task_kind: { type: 'string', enum: ['need', 'project', 'none'] },
    task_notes: { type: 'string', description: 'Notes to save with the task. Empty if none.' },
  },
  required: ['summary', 'urgency', 'approach', 'pro_trade', 'likely_causes', 'steps', 'safety', 'task_title', 'task_kind', 'task_notes'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a practical home maintenance advisor inside a homeowner's private maintenance tracker. Help them work out what is going on, what to do next, and whether to handle it themselves or hire a professional.

Use the home details below when they are relevant, and do not invent details about the home that are not listed. Be specific and concise; plain language over jargon.

Safety comes first. For a gas smell, sparks or a hot outlet or panel, active flooding, a suspected carbon monoxide problem, or structural movement, set urgency to "emergency" and lead the steps with the immediate safety action (leave the area, shut off the supply, call the utility or emergency services).

When a photo is included, describe what you can actually see, and say what you cannot tell from a photo. If the task is worth tracking, fill in the task fields; otherwise leave them empty and set task_kind to "none". Answer only in the requested structure.`;

function homeContext() {
  const profile = getProfile();
  const lines = [];
  if (profile.year_built) lines.push(`Built: ${profile.year_built}`);
  if (profile.sq_ft) lines.push(`Size: ${profile.sq_ft} sq ft`);
  const features = profile.features.map((k) => HOME_FEATURES.find((f) => f.key === k)?.label).filter(Boolean);
  if (features.length) lines.push(`Features: ${features.join(', ')}`);

  const equipment = listAppliances().map((a) => {
    const type = APPLIANCE_CATEGORIES.find((c) => c.key === a.category)?.label;
    const showType = type && !type.toLowerCase().includes(a.name.toLowerCase()); // "Water heater (Water heater)" adds nothing
    const age = a.age_years != null ? `${a.age_years} years old` : 'age unknown';
    return `- ${a.name}${showType ? ` (${type})` : ''}, ${age}${a.location ? `, ${a.location}` : ''}`;
  });
  if (equipment.length) lines.push('Equipment:', ...equipment);

  const overdue = listMaintenance().filter((m) => m.base_status === 'overdue').map((m) => m.name);
  if (overdue.length) lines.push(`Overdue maintenance: ${overdue.join(', ')}`);
  return lines.length ? lines.join('\n') : 'No home details have been recorded yet.';
}

/** Checks the client's conversation and converts it to API messages. */
export function buildMessages(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_MESSAGES) {
    throw new HttpError(400, `Send between 1 and ${MAX_MESSAGES} messages`);
  }
  let images = 0;
  const out = input.map((m, i) => {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (m?.role !== role) throw new HttpError(400, 'Messages must alternate between you and the assistant');
    const text = typeof m.text === 'string' ? m.text.trim() : '';

    if (role === 'assistant') {
      if (!text || text.length > MAX_ASSISTANT_CHARS) throw new HttpError(400, 'Invalid assistant message');
      return { role, content: text };
    }
    if (text.length > MAX_USER_CHARS) throw new HttpError(400, `Keep each message under ${MAX_USER_CHARS} characters`);
    const content = [];
    if (m.image) {
      images += 1;
      if (images > MAX_IMAGES) throw new HttpError(400, `Attach at most ${MAX_IMAGES} photos per conversation`);
      if (!IMAGE_TYPES.includes(m.image.media_type) || typeof m.image.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(m.image.data)) {
        throw new HttpError(400, 'Photos must be JPEG, PNG, GIF or WebP');
      }
      if (m.image.data.length > MAX_IMAGE_BASE64_CHARS) throw new HttpError(413, 'That photo is too large');
      content.push({ type: 'image', source: { type: 'base64', media_type: m.image.media_type, data: m.image.data } });
    }
    if (!text && !content.length) throw new HttpError(400, 'Describe the problem or attach a photo');
    content.push({ type: 'text', text: text || 'What is this and what should I do?' });
    return { role, content };
  });
  if (out.at(-1).role !== 'user') throw new HttpError(400, 'The last message must be yours');
  return out;
}

// A small in-memory limit so a stuck script or a curious child can't run up a bill.
const recent = [];
function checkRate(now = Date.now()) {
  const limit = Number(process.env.ASSISTANT_RATE_PER_HOUR || 20);
  while (recent.length && now - recent[0] > 3_600_000) recent.shift();
  if (recent.length >= limit) throw new HttpError(429, `Assistant limit reached (${limit} questions per hour)`);
  recent.push(now);
}
export const _resetRateLimitForTests = () => { recent.length = 0; };

let loadSdk = async () => (await import('@anthropic-ai/sdk')).default;
export const _setSdkLoaderForTests = (fn) => { loadSdk = fn; };

function toHttpError(err, Anthropic) {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'The Anthropic API is rate limiting requests. Try again in a minute.');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, 'The Anthropic API rejected the API key. Check ANTHROPIC_API_KEY.');
  }
  if (err instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Could not reach the Anthropic API from this server.');
  if (err instanceof Anthropic.APIError) return new HttpError(502, `The Anthropic API returned an error (${err.status}).`);
  return err;
}

const EMPTY_REPLY = {
  summary: '', urgency: 'routine', approach: 'either', pro_trade: '', likely_causes: [], steps: [],
  safety: '', task_title: '', task_kind: 'none', task_notes: '',
};

export async function ask(input) {
  if (!hasCredentials()) throw new HttpError(503, 'The assistant is turned off. Set ANTHROPIC_API_KEY to enable it.');
  const messages = buildMessages(input);
  checkRate();

  const Anthropic = await loadSdk();
  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });

  let response;
  try {
    response = await client.beta.messages.create({
      model: model(),
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      // If the safety classifiers decline a request, retry it on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: `${SYSTEM_PROMPT}\n\nHome details:\n${homeContext()}`,
      messages,
      output_config: { format: { type: 'json_schema', schema: REPLY_SCHEMA } },
    });
  } catch (err) {
    throw toHttpError(err, Anthropic);
  }

  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'The assistant could not help with that request. Try rephrasing it.');
  }
  if (response.stop_reason === 'max_tokens') throw new HttpError(502, 'The answer was cut off. Try a shorter question.');

  const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  let reply;
  try {
    reply = { ...EMPTY_REPLY, ...JSON.parse(raw) };
  } catch {
    reply = { ...EMPTY_REPLY, summary: raw }; // show whatever came back rather than failing
  }

  return {
    reply,
    raw,
    model: response.model,
    fallback_used: (response.usage?.iterations ?? []).some((i) => i.type === 'fallback_message'),
    usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
  };
}
