import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteRouter, getRouter, listRouters, saveRouter } from '../lib/router-store.js';
import { registerUser } from '../lib/auth.js';
import { closeDatabase } from '../lib/database.js';

test('menyimpan password router secara terenkripsi', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mikrotik-router-store-'));
  process.env.DATABASE_PATH = path.join(directory, `${crypto.randomUUID()}.db`);
  try {
    const owner = registerUser({ name: 'Pemilik Router', email: 'owner@example.test', password: 'password-kuat' });
    const other = registerUser({ name: 'Pengguna Lain', email: 'other@example.test', password: 'password-kuat' });
    const saved = saveRouter({ userId: owner.id, name: 'Router kantor', connection: { host: '192.168.88.1', port: 8728, username: 'admin', password: 'router-secret' } }, 'dashboard-secret');
    const raw = await fs.readFile(process.env.DATABASE_PATH);
    assert.equal(raw.includes('router-secret'), false);
    assert.equal(listRouters(owner.id)[0].name, 'Router kantor');
    assert.equal(listRouters(owner.id)[0].port, 8728);
    assert.deepEqual(listRouters(other.id), []);
    assert.equal(getRouter(saved.id, owner.id, 'dashboard-secret').password, 'router-secret');
    assert.equal(getRouter(saved.id, owner.id, 'dashboard-secret').port, 8728);
    assert.throws(() => getRouter(saved.id, other.id, 'dashboard-secret'), /tidak ditemukan/);
    deleteRouter(saved.id, owner.id);
    assert.deepEqual(listRouters(owner.id), []);
  } finally {
    closeDatabase();
    delete process.env.DATABASE_PATH;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
