import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerUser } from '../lib/auth.js';
import { closeDatabase } from '../lib/database.js';
import { createRemoteRouter, deleteRemoteRouter, getRemoteRouter, listRemoteRouters, markRemoteRouterOnline } from '../lib/remote-router-store.js';
import { listRouters, saveRouter } from '../lib/router-store.js';

test('membuat dan mencabut akun SSTP milik pengguna', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mikrotik-sstp-'));
  const previous = Object.fromEntries(Object.keys(process.env).filter(key => key.startsWith('SSTP_') || key === 'DATABASE_PATH').map(key => [key, process.env[key]]));
  process.env.DATABASE_PATH = path.join(directory, `${crypto.randomUUID()}.db`);
  process.env.SSTP_PUBLIC_HOST = 'vpn.example.test';
  process.env.SSTP_SERVER_IP = '10.90.0.1';
  process.env.SSTP_POOL_START = '10.90.0.10';
  process.env.SSTP_POOL_END = '10.90.0.11';
  process.env.SSTP_CHAP_SECRETS_PATH = path.join(directory, 'chap-secrets');
  try {
    const owner = registerUser({ name: 'Pemilik', email: 'sstp-owner@example.test', password: 'password-kuat' });
    const other = registerUser({ name: 'Lain', email: 'sstp-other@example.test', password: 'password-kuat' });
    const created = createRemoteRouter({ userId: owner.id, name: 'Cabang', routerosVersion: 6, routerUsername: 'api', routerPassword: 'rahasia-router' }, 'app-secret-test');
    assert.equal(created.vpnIp, '10.90.0.10');
    assert.match(created.script, /interface sstp-client/);
    assert.match(created.script, /verify-server-certificate=yes/);
    assert.doesNotMatch(created.script, /rahasia-router/);
    assert.equal(listRemoteRouters(owner.id).length, 1);
    assert.equal(listRemoteRouters(other.id).length, 0);
    assert.equal(getRemoteRouter(created.id, owner.id, 'app-secret-test').connection.password, 'rahasia-router');
    assert.throws(() => getRemoteRouter(created.id, other.id, 'app-secret-test'), /tidak ditemukan/);
    const secrets = await fs.readFile(process.env.SSTP_CHAP_SECRETS_PATH, 'utf8');
    assert.match(secrets, /10\.90\.0\.10/);
    assert.doesNotMatch(secrets, /rahasia-router/);
    const saved = saveRouter({ userId: owner.id, name: 'Cabang', connection: getRemoteRouter(created.id, owner.id, 'app-secret-test').connection }, 'app-secret-test');
    markRemoteRouterOnline(created.id, owner.id, saved.id);
    assert.equal(listRouters(owner.id).length, 1);
    deleteRemoteRouter(created.id, owner.id, 'app-secret-test');
    assert.equal(listRemoteRouters(owner.id).length, 0);
    assert.equal(listRouters(owner.id).length, 0);
  } finally {
    closeDatabase();
    for (const key of Object.keys(process.env).filter(key => key.startsWith('SSTP_') || key === 'DATABASE_PATH')) delete process.env[key];
    Object.assign(process.env, previous);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
