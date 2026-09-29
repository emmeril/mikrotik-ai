import crypto from 'node:crypto';
import { getDatabase } from './database.js';

const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const publicUser = user => ({ id: user.id, name: user.name, email: user.email, createdAt: user.created_at });

export function registerUser({ name, email, password }) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanName.length < 2 || cleanName.length > 80) throw new Error('Nama harus berisi 2 sampai 80 karakter.');
  if (!emailPattern.test(cleanEmail) || cleanEmail.length > 254) throw new Error('Alamat email tidak valid.');
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new Error('Password harus berisi minimal 10 karakter.');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { id: crypto.randomUUID(), name: cleanName, email: cleanEmail, password_hash: crypto.scryptSync(password, salt, 64).toString('hex'), password_salt: salt, created_at: new Date().toISOString() };
  try { getDatabase().prepare('INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (@id,@name,@email,@password_hash,@password_salt,@created_at)').run(user); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') { const conflict = new Error('Email sudah terdaftar.'); conflict.status = 409; throw conflict; } throw error; }
  return publicUser(user);
}

export function authenticateUser({ email, password }) {
  const user = getDatabase().prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(email || '').trim());
  const supplied = typeof password === 'string' && user ? crypto.scryptSync(password, user.password_salt, 64) : Buffer.alloc(64);
  const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
  if (!user || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) { const error = new Error('Email atau password salah.'); error.status = 401; throw error; }
  return publicUser(user);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const database = getDatabase();
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  database.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(hashToken(token), userId, now + sessionLifetime, new Date(now).toISOString());
  return { token, maxAge: sessionLifetime };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = getDatabase().prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(hashToken(token), Date.now());
  return row ? publicUser(row) : null;
}

export function deleteSession(token) {
  if (token) getDatabase().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
