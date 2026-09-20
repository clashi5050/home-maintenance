import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-assistant-'));
process.env.SEED = 'false';
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
delete process.env.ASSISTANT_MODEL;

const assistant = await import('../server/assistant.js');
const { default: Anthropic } = await import('@anthropic-ai/sdk');
const store = await import('../server/resources.js');

// A stand-in for the SDK: records the request and returns whatever the test queues up.
const calls = [];
let next;
class FakeClient {
  constructor(options) {
    this.options = options;
    this.beta = { messages: { create: async (params) => { calls.push(params); return next(); } } };
  }
}
Object.assign(FakeClient, {
  RateLimitError: Anthropic.RateLimitError,
  AuthenticationError: Anthropic.AuthenticationError,
  PermissionDeniedError: Anthropic.PermissionDeniedError,
  APIConnectionError: Anthropic.APIConnectionError,
  APIError: Anthropic.APIError,
});
assistant._setSdkLoaderForTests(async () => FakeClient);

const goodReply = {
  summary: 'Likely a failed flapper.', urgency: 'routine', approach: 'diy', pro_trade: '',
  likely_causes: ['Worn flapper'], steps: ['Turn off the water', 'Replace the flapper'], safety: '',
  task_title: 'Replace toilet flapper', task_kind: 'need', task_notes: '',
};
const okResponse = (overrides = {}) => ({
  model: 'claude-opus-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(goodReply) }],
  usage: { input_tokens: 900, output_tokens: 300 },
  ...overrides,
});

beforeEach(() => {
  calls.length = 0;
  assistant._resetRateLimitForTests();
  next = async () => okResponse();
});

test('reports whether it is enabled and which model it uses', () => {
  assert.deepEqual(assistant.assistantStatus(), { enabled: true, model: 'claude-opus-5' });
});

test('sends the request the way the API expects', async () => {
  store.updateProfile({ year_built: 1998, features: ['gutters', 'pets'] });
  store.create('appliances', { name: 'Water heater', category: 'water_heater', purchase_date: '2016-01-01', expected_life_years: 10 });
  store.create('appliances', { name: 'Kitchen unit', category: 'dishwasher', location: 'Kitchen' });

  const result = await assistant.ask([{ role: 'user', text: 'Toilet keeps running' }]);
  assert.equal(calls.length, 1);
  const call = calls[0];

  assert.equal(call.model, 'claude-opus-5');
  assert.deepEqual(call.thinking, { type: 'adaptive' });
  assert.deepEqual(call.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(call.fallbacks, 'default');
  assert.equal(call.output_config.format.type, 'json_schema');
  assert.equal(call.output_config.format.schema.additionalProperties, false);
  assert.equal(call.temperature, undefined); // sampling parameters are rejected by this model family
  assert.ok(call.max_tokens >= 4096 && call.max_tokens <= 16000);

  assert.match(call.system, /Built: 1998/);
  assert.match(call.system, /Gutters/);
  assert.match(call.system, /- Water heater, \d+(\.\d+)? years old/, 'no repeated type when the name already says it');
  assert.match(call.system, /- Kitchen unit \(Dishwasher\), age unknown, Kitchen/);
  assert.deepEqual(call.messages, [{ role: 'user', content: [{ type: 'text', text: 'Toilet keeps running' }] }]);

  assert.equal(result.reply.summary, 'Likely a failed flapper.');
  assert.equal(result.reply.task_title, 'Replace toilet flapper');
  assert.equal(result.fallback_used, false);
  assert.deepEqual(result.usage, { input_tokens: 900, output_tokens: 300 });
});

test('never sends the address, insurance or purchase price', async () => {
  store.updateProfile({ address: '12 Secret Lane', insurance_policy: 'POL-99887', purchase_price: 555555 });
  await assistant.ask([{ role: 'user', text: 'Hi' }]);
  assert.doesNotMatch(calls[0].system, /Secret Lane|POL-99887|555555/);
});

test('photos go first, and follow-up turns carry the earlier reply', async () => {
  const image = { media_type: 'image/jpeg', data: Buffer.from('fake-jpeg-bytes').toString('base64') };
  await assistant.ask([
    { role: 'user', text: 'What is this stain?', image },
    { role: 'assistant', text: JSON.stringify(goodReply) },
    { role: 'user', text: 'It got bigger overnight' },
  ]);
  const { messages } = calls[0];
  assert.equal(messages.length, 3);
  assert.equal(messages[0].content[0].type, 'image');
  assert.equal(messages[0].content[0].source.type, 'base64');
  assert.equal(messages[0].content[1].type, 'text');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(typeof messages[1].content, 'string');
});

test('a photo with no text still gets a sensible question', async () => {
  const image = { media_type: 'image/png', data: 'AAAA' };
  await assistant.ask([{ role: 'user', text: '', image }]);
  assert.equal(calls[0].messages[0].content.at(-1).text, 'What is this and what should I do?');
});

test('rejects malformed conversations before spending anything', async () => {
  const bad = (messages, pattern) => assert.rejects(assistant.ask(messages), pattern);
  await bad([], /between 1 and 12/);
  await bad('hello', /between 1 and 12/);
  await bad([{ role: 'assistant', text: 'hi' }], /alternate/);
  await bad([{ role: 'user', text: 'a' }, { role: 'user', text: 'b' }], /alternate/);
  await bad([{ role: 'user', text: '' }], /Describe the problem/);
  await bad([{ role: 'user', text: 'x'.repeat(4001) }], /under 4000/);
  await bad([{ role: 'user', text: 'x', image: { media_type: 'image/svg+xml', data: 'AAAA' } }], /JPEG, PNG, GIF or WebP/);
  await bad([{ role: 'user', text: 'x', image: { media_type: 'image/png', data: 'not base64!!' } }], /JPEG, PNG, GIF or WebP/);
  assert.equal(calls.length, 0);
});

test('a refusal is reported plainly instead of crashing', async () => {
  next = async () => okResponse({ stop_reason: 'refusal', content: [] });
  await assert.rejects(assistant.ask([{ role: 'user', text: 'x' }]), (err) => err.status === 422 && /could not help/.test(err.message));
});

test('a truncated answer is reported', async () => {
  next = async () => okResponse({ stop_reason: 'max_tokens' });
  await assert.rejects(assistant.ask([{ role: 'user', text: 'x' }]), (err) => err.status === 502 && /cut off/.test(err.message));
});

test('non-JSON output is still shown to the user', async () => {
  next = async () => okResponse({ content: [{ type: 'text', text: 'Just call a plumber.' }] });
  const { reply } = await assistant.ask([{ role: 'user', text: 'x' }]);
  assert.equal(reply.summary, 'Just call a plumber.');
  assert.deepEqual(reply.steps, []);
});

test('notes when the fallback model served the answer', async () => {
  next = async () => okResponse({ usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: 'message' }, { type: 'fallback_message' }] } });
  assert.equal((await assistant.ask([{ role: 'user', text: 'x' }])).fallback_used, true);
});

test('API errors map to clear messages', async () => {
  const headers = new Headers();
  const err = (Class, status, type) => new Class(status, { type: 'error', error: { type, message: 'nope' } }, 'nope', headers);
  const cases = [
    [err(Anthropic.RateLimitError, 429, 'rate_limit_error'), 429, /rate limiting/],
    [err(Anthropic.AuthenticationError, 401, 'authentication_error'), 502, /rejected the API key/],
    [new Anthropic.APIConnectionError({ message: 'offline' }), 502, /Could not reach/],
    [err(Anthropic.InternalServerError, 500, 'api_error'), 502, /returned an error \(500\)/],
  ];
  for (const [thrown, status, pattern] of cases) {
    next = async () => { throw thrown; };
    await assert.rejects(assistant.ask([{ role: 'user', text: 'x' }]), (e) => e.status === status && pattern.test(e.message));
  }
});

test('the hourly limit stops runaway use', async () => {
  process.env.ASSISTANT_RATE_PER_HOUR = '2';
  try {
    await assistant.ask([{ role: 'user', text: '1' }]);
    await assistant.ask([{ role: 'user', text: '2' }]);
    await assert.rejects(assistant.ask([{ role: 'user', text: '3' }]), (e) => e.status === 429 && /2 questions per hour/.test(e.message));
    assert.equal(calls.length, 2);
  } finally {
    delete process.env.ASSISTANT_RATE_PER_HOUR;
  }
});

test('without credentials it refuses to run', async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(assistant.assistantStatus().enabled, false);
    await assert.rejects(assistant.ask([{ role: 'user', text: 'x' }]), (e) => e.status === 503);
    assert.equal(calls.length, 0);
  } finally {
    process.env.ANTHROPIC_API_KEY = key;
  }
});
