import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './database.js';
import { decryptSecret, encryptSecret } from './router-store.js';

const cleanName = value => {
  const result = String(value || '').trim();
  if (!result || result.length > 80 || /[\r\n\x00-\x1f]/.test(result)) throw new Error('Nama router tidak valid.');
  return result;
};

function ipNumber(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) throw new Error('Konfigurasi pool SSTP tidak valid.');
  return parts.reduce((total, part) => total * 256 + Number(part), 0) >>> 0;
}

function numberIp(value) {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
}

export function sstpConfig() {
  const config = {
    publicHost: String(process.env.SSTP_PUBLIC_HOST || '').trim(),
    serverIp: String(process.env.SSTP_SERVER_IP || '').trim(),
    poolStart: String(process.env.SSTP_POOL_START || '').trim(),
    poolEnd: String(process.env.SSTP_POOL_END || '').trim(),
    secretsPath: String(process.env.SSTP_CHAP_SECRETS_PATH || '').trim(),
    caUrl: String(process.env.SSTP_CA_CERT_URL || '').trim()
  };
  config.ready = Boolean(config.publicHost && config.serverIp && config.poolStart && config.poolEnd && config.secretsPath);
  return config;
}

const publicRemote = row => ({ id: row.id, routerId: row.router_id || '', name: row.name, routerosVersion: row.routeros_version, vpnIp: row.vpn_ip, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at });

export function listRemoteRouters(userId) {
  return getDatabase().prepare('SELECT * FROM remote_routers WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(publicRemote);
}

function nextIp(database, config) {
  const start = ipNumber(config.poolStart);
  const end = ipNumber(config.poolEnd);
  if (end < start || end - start > 65535) throw new Error('Rentang pool SSTP tidak valid.');
  const used = new Set(database.prepare('SELECT vpn_ip FROM remote_routers').all().map(row => row.vpn_ip));
  for (let value = start; value <= end; value += 1) {
    const candidate = numberIp(value);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Pool alamat SSTP sudah penuh.');
}

function routerosQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function buildScript(record, password, config) {
  const lines = [];
  if (config.caUrl) lines.push(`/tool fetch url=${routerosQuote(config.caUrl)} dst-path=mikrotik-ai-ca.crt`, '/certificate import file-name=mikrotik-ai-ca.crt passphrase=""');
  lines.push(
    `/interface sstp-client add name=mikrotik-ai connect-to=${routerosQuote(config.publicHost)} user=${routerosQuote(record.vpn_username)} password=${routerosQuote(password)} profile=default-encryption add-default-route=no verify-server-certificate=yes disabled=no`,
    `/ip service set api disabled=no port=8728 address=${config.serverIp}/32`,
    `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728 src-address=${config.serverIp} place-before=0 comment=${routerosQuote('MikroTik AI via SSTP')}`
  );
  return lines.join('\n');
}

export function syncSstpSecrets(appSecret) {
  const config = sstpConfig();
  if (!config.ready) throw new Error('Provisioning SSTP belum dikonfigurasi di server.');
  const rows = getDatabase().prepare('SELECT vpn_username,encrypted_vpn_password,vpn_ip FROM remote_routers ORDER BY created_at').all();
  const content = ['# Managed by MikroTik AI. Do not edit manually.', ...rows.map(row => `"${row.vpn_username}" * "${decryptSecret(row.encrypted_vpn_password, appSecret)}" ${row.vpn_ip}`), ''].join('\n');
  const directory = path.dirname(config.secretsPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${config.secretsPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, config.secretsPath);
}

export function createRemoteRouter({ userId, name, routerosVersion, routerUsername, routerPassword }, appSecret) {
  const config = sstpConfig();
  if (!config.ready) throw new Error('Provisioning SSTP belum dikonfigurasi di server.');
  ipNumber(config.serverIp);
  if (![6, 7].includes(Number(routerosVersion))) throw new Error('Pilih RouterOS 6 atau 7.');
  const username = String(routerUsername || '').trim();
  const password = String(routerPassword || '');
  if (!username || username.length > 64 || !password || password.length > 256) throw new Error('Kredensial API RouterOS wajib diisi.');
  const database = getDatabase();
  const id = crypto.randomUUID();
  const vpnPassword = crypto.randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  const record = { id, user_id: userId, router_id: null, name: cleanName(name), routeros_version: Number(routerosVersion), vpn_username: `mai-${id.replaceAll('-', '').slice(0, 16)}`, encrypted_vpn_password: encryptSecret(vpnPassword, appSecret), vpn_ip: nextIp(database, config), router_username: username, encrypted_router_password: encryptSecret(password, appSecret), status: 'waiting', created_at: now, updated_at: now };
  database.prepare(`INSERT INTO remote_routers (id,user_id,router_id,name,routeros_version,vpn_username,encrypted_vpn_password,vpn_ip,router_username,encrypted_router_password,status,created_at,updated_at) VALUES (@id,@user_id,@router_id,@name,@routeros_version,@vpn_username,@encrypted_vpn_password,@vpn_ip,@router_username,@encrypted_router_password,@status,@created_at,@updated_at)`).run(record);
  try { syncSstpSecrets(appSecret); }
  catch (error) { database.prepare('DELETE FROM remote_routers WHERE id = ?').run(id); throw error; }
  return { ...publicRemote(record), script: buildScript(record, vpnPassword, config) };
}

export function getRemoteRouter(id, userId, appSecret) {
  const row = getDatabase().prepare('SELECT * FROM remote_routers WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw new Error('Router jarak jauh tidak ditemukan.');
  return { row, connection: { host: row.vpn_ip, port: 8728, username: row.router_username, password: decryptSecret(row.encrypted_router_password, appSecret) } };
}

export function markRemoteRouterOnline(id, userId, routerId) {
  const now = new Date().toISOString();
  getDatabase().prepare("UPDATE remote_routers SET router_id=?,status='online',updated_at=? WHERE id=? AND user_id=?").run(routerId, now, id, userId);
}

export function deleteRemoteRouter(id, userId, appSecret) {
  const database = getDatabase();
  const remote = database.prepare('SELECT router_id FROM remote_routers WHERE id = ? AND user_id = ?').get(id, userId);
  if (!remote) throw new Error('Router jarak jauh tidak ditemukan.');
  database.transaction(() => {
    database.prepare('DELETE FROM remote_routers WHERE id = ? AND user_id = ?').run(id, userId);
    if (remote.router_id) database.prepare('DELETE FROM routers WHERE id = ? AND user_id = ?').run(remote.router_id, userId);
  })();
  syncSstpSecrets(appSecret);
}
