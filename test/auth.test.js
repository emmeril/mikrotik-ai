import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authenticateUser, createSession, deleteSession, getSessionUser, registerUser } from '../lib/auth.js';

test('registrasi, login, dan sesi pengguna', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mikrotik-auth-'));
  process.env.DATABASE_PATH = path.join(directory, `${crypto.randomUUID()}.db`);
  try {
    const user = registerUser({ name: 'Operator Jaringan', email: 'operator@example.test', password: 'password-kuat' });
    assert.equal(authenticateUser({ email: 'OPERATOR@example.test', password: 'password-kuat' }).id, user.id);
    assert.throws(() => authenticateUser({ email: user.email, password: 'password-salah' }), /Email atau password salah/);
    const session = createSession(user.id);
    assert.equal(getSessionUser(session.token).email, user.email);
    deleteSession(session.token);
    assert.equal(getSessionUser(session.token), null);
  } finally {
    delete process.env.DATABASE_PATH;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
