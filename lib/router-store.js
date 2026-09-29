import crypto from 'node:crypto';
import { getDatabase } from './database.js';

const salt = 'mikrotik-ai-router-store-v2';

function keyFromSecret(secret) {
  if (!secret) throw new Error('APP_SECRET wajib diisi untuk menyimpan router.');
  return crypto.scryptSync(secret, salt, 32);
}

function encrypt(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), value: encrypted.toString('base64') });
}

function decrypt(payload, secret) {
  try {
    const parsed = JSON.parse(payload);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parsed.value, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Kredensial router tidak dapat dibuka. Periksa APP_SECRET.');
  }
}

const publicRouter = router => ({ id: router.id, name: router.name, host: router.host, port: router.port, username: router.username, secure: Boolean(router.secure), allowSelfSigned: Boolean(router.allow_self_signed), updatedAt: router.updated_at, hasPassword: true });

export function listRouters(userId) {
  return getDatabase().prepare('SELECT * FROM routers WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId).map(publicRouter);
}

export function getRouter(id, userId, appSecret) {
  const router = getDatabase().prepare('SELECT * FROM routers WHERE id = ? AND user_id = ?').get(id, userId);
  if (!router) throw new Error('Router tersimpan tidak ditemukan.');
  return { host: router.host, port: router.port, username: router.username, password: decrypt(router.encrypted_password, appSecret), secure: Boolean(router.secure), allowSelfSigned: Boolean(router.allow_self_signed) };
}

export function saveRouter({ id, userId, name, connection }, appSecret) {
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > 80 || /[\r\n\x00-\x1f]/.test(cleanName)) throw new Error('Nama profil router tidak valid.');
  const existing = id ? getDatabase().prepare('SELECT id FROM routers WHERE id = ? AND user_id = ?').get(id, userId) : null;
  const routerId = existing?.id || crypto.randomUUID();
  const record = { id: routerId, user_id: userId, name: cleanName, host: connection.host, port: Number(connection.port), username: connection.username, encrypted_password: encrypt(connection.password, appSecret), secure: connection.secure !== false ? 1 : 0, allow_self_signed: connection.allowSelfSigned === true ? 1 : 0, updated_at: new Date().toISOString() };
  getDatabase().prepare(`INSERT INTO routers (id,user_id,name,host,port,username,encrypted_password,secure,allow_self_signed,updated_at)
    VALUES (@id,@user_id,@name,@host,@port,@username,@encrypted_password,@secure,@allow_self_signed,@updated_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,encrypted_password=excluded.encrypted_password,secure=excluded.secure,allow_self_signed=excluded.allow_self_signed,updated_at=excluded.updated_at
    WHERE routers.user_id=excluded.user_id`).run(record);
  return publicRouter(record);
}

export function deleteRouter(id, userId) {
  const result = getDatabase().prepare('DELETE FROM routers WHERE id = ? AND user_id = ?').run(id, userId);
  if (!result.changes) throw new Error('Router tersimpan tidak ditemukan.');
}
