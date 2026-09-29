import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compilePlan, isDiagnosticPlan } from './lib/plan.js';
import { connectRouter } from './lib/routeros.js';
import { generateRouterPlan, reviewRouterPlan } from './lib/gemini.js';
import { deleteRouter, getRouter, listRouters, saveRouter as saveRouterProfile } from './lib/router-store.js';
import { authenticateUser, createSession, deleteSession, getSessionUser, registerUser } from './lib/auth.js';
import { getDatabase } from './lib/database.js';
import { addConversationEntry, deleteConversation, getConversation, listConversations } from './lib/conversation-store.js';
import { collectRouterSnapshot, sanitizeRouterRows, snapshotFingerprint, snapshotForAi, validatePlanAgainstSnapshot } from './lib/router-snapshot.js';

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const appSecret = process.env.APP_SECRET || process.env.APP_PASSWORD;
if (!appSecret) throw new Error('APP_SECRET wajib diisi.');
getDatabase();
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const geminiFallbackModels = String(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.1-flash-lite').split(',').map(value => value.trim()).filter(Boolean);

const plans = new Map();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'mikrotik-ai-console') return res.status(403).json({ error: 'Permintaan tidak valid.' });
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origin tidak diizinkan.' });
    } catch {
      return res.status(403).json({ error: 'Origin tidak valid.' });
    }
  }
  next();
});
app.use(express.static(publicDir));
app.use('/vendor/bootstrap', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules/bootstrap/dist')));
app.use('/vendor/alpine', express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules/alpinejs/dist')));

function savePlan(raw, userId, metadata = {}) {
  const plan = compilePlan(raw);
  const id = crypto.randomUUID();
  plans.set(id, { plan, userId, expires: Date.now() + 15 * 60_000, ...metadata });
  for (const [key, value] of plans) if (value.expires < Date.now()) plans.delete(key);
  return { id, ...plan };
}

function getPlanEntry(id, userId) {
  const entry = plans.get(id);
  if (!entry || entry.userId !== userId || entry.expires < Date.now()) throw new Error('Rencana kedaluwarsa atau tidak tersedia. Buat ulang sebelum menerapkan.');
  return entry;
}

function errorResponse(res, error) {
  res.status(error.status || 400).json({ error: error.message || 'Permintaan gagal.', ...(error.details || {}) });
}

function sessionToken(req) {
  const cookie = req.get('cookie') || '';
  const match = cookie.split(';').map(value => value.trim()).find(value => value.startsWith('mikrotik_session='));
  return match ? decodeURIComponent(match.slice('mikrotik_session='.length)) : '';
}

function setSessionCookie(res, session) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.set('Set-Cookie', `mikrotik_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(session.maxAge / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.set('Set-Cookie', `mikrotik_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function requireUser(req, res, next) {
  const user = getSessionUser(sessionToken(req));
  if (!user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  req.user = user;
  next();
}

async function resolveConnection(body, userId) {
  const connection = body.savedRouterId ? getRouter(String(body.savedRouterId), userId, appSecret) : body.connection || {};
  return { ...connection, port: 8728 };
}

app.get('/api/status', (_req, res) => res.json({ aiReady: Boolean(process.env.GEMINI_API_KEY), routerStoreReady: true, registrationEnabled: true, model: geminiModel, provider: 'gemini' }));

app.get('/api/auth/me', (req, res) => res.json({ user: getSessionUser(sessionToken(req)) }));

app.post('/api/auth/register', (req, res) => {
  try { const user = registerUser(req.body || {}); setSessionCookie(res, createSession(user.id)); res.status(201).json({ user }); }
  catch (error) { errorResponse(res, error); }
});

app.post('/api/auth/login', (req, res) => {
  try { const user = authenticateUser(req.body || {}); setSessionCookie(res, createSession(user.id)); res.json({ user }); }
  catch (error) { errorResponse(res, error); }
});

app.post('/api/auth/logout', (req, res) => { deleteSession(sessionToken(req)); clearSessionCookie(res); res.json({ loggedOut: true }); });

app.use('/api', requireUser);

app.get('/api/routers', async (req, res) => {
  try { res.json({ routers: await listRouters(req.user.id) }); }
  catch (error) { errorResponse(res, error); }
});

app.delete('/api/routers/:id', async (req, res) => {
  try { await deleteRouter(req.params.id, req.user.id); res.json({ deleted: true }); }
  catch (error) { errorResponse(res, error); }
});

app.get('/api/conversations', (req, res) => {
  try { res.json({ conversations: listConversations(req.user.id) }); }
  catch (error) { errorResponse(res, error); }
});

app.get('/api/conversations/:id', (req, res) => {
  try { res.json({ conversation: getConversation(req.params.id, req.user.id) }); }
  catch (error) { errorResponse(res, error); }
});

app.delete('/api/conversations/:id', (req, res) => {
  try { deleteConversation(req.params.id, req.user.id); res.json({ deleted: true }); }
  catch (error) { errorResponse(res, error); }
});

app.post('/api/router/test', async (req, res) => {
  let client;
  try {
    const connection = await resolveConnection(req.body, req.user.id);
    client = await connectRouter(connection);
    const resource = await client.command(['/system/resource/print']);
    const identity = await client.command(['/system/identity/print']);
    const info = resource.rows[0] || {};
    const savedRouter = req.body.saveRouter ? await saveRouterProfile({ id: req.body.savedRouterId, userId: req.user.id, name: req.body.saveRouter.name, connection }, appSecret) : undefined;
    res.json({ identity: identity.rows[0]?.name || '-', version: info.version || '-', board: info['board-name'] || '-', uptime: info.uptime || '-', savedRouter });
  } catch (error) { errorResponse(res, error); }
  finally { client?.close(); }
});

app.post('/api/plan/template', (req, res) => {
  try {
    const { type, values = {} } = req.body;
    const templates = {
      identity: { summary: 'Mengubah nama router.', actions: [{ type: 'set_identity', name: values.name }] },
      dns: { summary: 'Mengatur server DNS router.', actions: [{ type: 'set_dns', servers: String(values.servers || '').split(',').map(s => s.trim()) }] },
      address: { summary: 'Menambahkan alamat IP pada interface.', actions: [{ type: 'add_ip_address', address: values.address, interface: values.interface }] },
      route: { summary: 'Menambahkan static route.', actions: [{ type: 'add_static_route', dstAddress: values.dstAddress, gateway: values.gateway }] }
    };
    if (!Object.hasOwn(templates, type)) throw new Error('Template tidak tersedia.');
    const plan = savePlan(templates[type], req.user.id);
    const labels = { identity: 'Nama router', dns: 'DNS server', address: 'Alamat IP', route: 'Static route' };
    const conversation = addConversationEntry({ userId: req.user.id, conversationId: req.body.conversationId, prompt: `Formulir cepat: ${labels[type]}`, plan });
    res.json({ ...plan, conversationId: conversation.id });
  } catch (error) { errorResponse(res, error); }
});

async function generateRawPlan(prompt, snapshot) {
  if (prompt.length < 8 || prompt.length > 1500) throw new Error('Prompt harus berisi 8 sampai 1500 karakter.');
  return generateRouterPlan(prompt, { apiKey: process.env.GEMINI_API_KEY, model: geminiModel, fallbackModels: geminiFallbackModels, snapshot: snapshotForAi(snapshot) });
}

app.post('/api/plan/generate', async (req, res) => {
  let client;
  try {
    const prompt = String(req.body.prompt || '').trim();
    client = await connectRouter(await resolveConnection(req.body, req.user.id));
    const snapshot = await collectRouterSnapshot(client);
    const raw = await generateRawPlan(prompt, snapshot);
    const plan = savePlan(raw, req.user.id, { baselineFingerprint: snapshotFingerprint(snapshot) });
    const conversation = addConversationEntry({ userId: req.user.id, conversationId: req.body.conversationId, prompt, plan });
    res.json({ ...plan, conversationId: conversation.id });
  } catch (error) { errorResponse(res, error); }
  finally { client?.close(); }
});

app.post('/api/plan/apply', async (req, res) => {
  let client;
  try {
    const entry = getPlanEntry(req.body.id, req.user.id);
    const plan = entry.plan;
    if (!plan.actions.length) throw new Error('Rencana ini hanya berisi panduan manual.');
    if (!isDiagnosticPlan(plan) && req.body.confirmed !== true) throw new Error('Konfirmasi penerapan tidak valid.');
    client = await connectRouter(await resolveConnection(req.body, req.user.id));
    const snapshot = await collectRouterSnapshot(client);
    const configurationChanged = Boolean(entry.baselineFingerprint && entry.baselineFingerprint !== snapshotFingerprint(snapshot));
    const deterministicRisks = validatePlanAgainstSnapshot(plan, snapshot);
    if (deterministicRisks.length) {
      const preflight = { safe: false, summary: 'Pemeriksaan konfigurasi menemukan target yang tidak valid atau sudah tersedia.', risks: deterministicRisks, checks: ['Validasi interface, ID, alamat IP, dan route'], configurationChanged, capturedAt: snapshot.capturedAt, unavailableSections: snapshot.unavailable };
      return res.status(409).json({ error: 'Penerapan diblokir oleh pemeriksaan konfigurasi.', preflight });
    }
    const review = await reviewRouterPlan(plan, snapshotForAi(snapshot), { apiKey: process.env.GEMINI_API_KEY, model: geminiModel, fallbackModels: geminiFallbackModels, configurationChanged });
    const preflight = { ...review, configurationChanged, capturedAt: snapshot.capturedAt, unavailableSections: snapshot.unavailable };
    if (!review.safe) return res.status(409).json({ error: 'Penerapan diblokir karena pemeriksaan menemukan risiko atau konflik.', preflight });
    plans.delete(req.body.id);
    const results = [];
    for (const action of plan.actions) {
      try {
        const output = await client.command(action.sentence);
        results.push({ title: action.title, kind: action.kind || 'write', ok: true, data: sanitizeRouterRows(output.rows.slice(0, 50)) });
      } catch (error) {
        results.push({ title: action.title, ok: false, error: error.message });
        break;
      }
    }
    res.json({ preflight, results });
  } catch (error) { errorResponse(res, error); }
  finally { client?.close(); }
});

app.listen(port, host, () => console.log(`MikroTik AI Console: http://${host}:${port}`));
