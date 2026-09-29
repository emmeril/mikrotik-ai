import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGeminiJson, generateRouterPlan, reviewRouterPlan } from '../lib/gemini.js';

test('membaca structured output Gemini', () => {
  const plan = extractGeminiJson({ candidates: [{ content: { parts: [{ text: '{"summary":"Atur DNS","manual":"","warnings":[],"actions":[]}' }] } }] });
  assert.equal(plan.summary, 'Atur DNS');
  assert.deepEqual(plan.actions, []);
});

test('mengirim schema dan API key ke Gemini Generate Content', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"Siap","manual":"","warnings":[],"actions":[]}' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const plan = await generateRouterPlan('Atur nama router kantor', { apiKey: 'gemini-test-key', model: 'gemini-test-model', fetchImpl });
  assert.equal(plan.summary, 'Siap');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'], 'gemini-test-key');
  assert.equal(request.body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.equal(request.body.generationConfig.responseFormat.text.schema.properties.actions.maxItems, 20);
  assert.match(request.body.contents[0].parts[0].text, /Atur nama router kantor/);
});

test('meminta Gemini menilai keamanan rencana terhadap snapshot', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"safe":false,"summary":"Gateway tidak tersedia","risks":["Route dapat terputus"],"checks":["Gateway"]}' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const review = await reviewRouterPlan({ summary: 'Route', actions: [{ title: 'Tambah route', cli: '/ip route add' }] }, '{"routes":[]}', { apiKey: 'gemini-test-key', model: 'gemini-test-model', fetchImpl, configurationChanged: true });
  assert.equal(review.safe, false);
  assert.equal(request.generationConfig.responseFormat.text.schema.properties.safe.type, 'boolean');
  assert.match(request.contents[0].parts[0].text, /configurationChanged/);
});

test('menampilkan alasan ketika Gemini tidak mengembalikan kandidat', () => {
  assert.throws(() => extractGeminiJson({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
});

test('mengulang permintaan saat Gemini sementara sibuk', async () => {
  let calls = 0;
  const delays = [];
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"Berhasil","manual":"","warnings":[],"actions":[]}' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const plan = await generateRouterPlan('Atur router setelah retry', { apiKey: 'gemini-test-key', model: 'gemini-test-model', fetchImpl, sleepImpl: async delay => delays.push(delay), maxRetries: 1 });
  assert.equal(plan.summary, 'Berhasil');
  assert.equal(calls, 2);
  assert.equal(delays.length, 1);
});

test('beralih ke model cadangan ketika model utama tetap sibuk', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.includes('model-utama')) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"Model cadangan","manual":"","warnings":[],"actions":[]}' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const plan = await generateRouterPlan('Gunakan model cadangan', { apiKey: 'gemini-test-key', model: 'model-utama', fallbackModels: ['model-cadangan'], fetchImpl, maxRetries: 0 });
  assert.equal(plan.summary, 'Model cadangan');
  assert.ok(urls[1].includes('model-cadangan'));
});

test('menampilkan pesan lokal setelah seluruh retry gagal', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => generateRouterPlan('Coba saat sibuk', { apiKey: 'gemini-test-key', model: 'model-utama', fetchImpl, sleepImpl: async () => {}, maxRetries: 1 }), /beberapa percobaan otomatis/);
});
