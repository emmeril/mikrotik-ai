import crypto from 'node:crypto';
import { getDatabase } from './database.js';

function titleFromPrompt(prompt) {
  const clean = String(prompt || '').replace(/\s+/g, ' ').trim();
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean;
}

function publicConversation(row) {
  return {
    id: row.id,
    title: row.title,
    entryCount: Number(row.entry_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listConversations(userId) {
  const rows = getDatabase().prepare(`
    SELECT conversations.*, COUNT(conversation_entries.id) AS entry_count
    FROM conversations
    LEFT JOIN conversation_entries ON conversation_entries.conversation_id = conversations.id
    WHERE conversations.user_id = ?
    GROUP BY conversations.id
    ORDER BY conversations.updated_at DESC
    LIMIT 50
  `).all(userId);
  return rows.map(publicConversation);
}

export function getConversation(id, userId) {
  const database = getDatabase();
  const row = database.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw new Error('Riwayat percakapan tidak ditemukan.');
  const entries = database.prepare(`
    SELECT * FROM (
      SELECT id, prompt, plan_json, created_at
      FROM conversation_entries
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    )
    ORDER BY created_at
  `).all(id).map(entry => ({
    id: entry.id,
    prompt: entry.prompt,
    plan: JSON.parse(entry.plan_json),
    createdAt: entry.created_at
  }));
  return { ...publicConversation({ ...row, entry_count: entries.length }), entries };
}

export function addConversationEntry({ userId, conversationId, prompt, plan }) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt || cleanPrompt.length > 1500) throw new Error('Prompt riwayat tidak valid.');
  const planJson = JSON.stringify(plan);
  if (planJson.length > 256 * 1024) throw new Error('Rencana terlalu besar untuk disimpan dalam riwayat.');
  const database = getDatabase();
  const now = new Date().toISOString();
  return database.transaction(() => {
    let id = conversationId ? String(conversationId) : '';
    if (id) {
      const existing = database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(id, userId);
      if (!existing) throw new Error('Riwayat percakapan tidak ditemukan.');
    } else {
      id = crypto.randomUUID();
      database.prepare('INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)')
        .run(id, userId, titleFromPrompt(cleanPrompt), now, now);
    }
    database.prepare('INSERT INTO conversation_entries (id,conversation_id,prompt,plan_json,created_at) VALUES (?,?,?,?,?)')
      .run(crypto.randomUUID(), id, cleanPrompt, planJson, now);
    database.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?').run(now, id, userId);
    return { id };
  })();
}

export function deleteConversation(id, userId) {
  const result = getDatabase().prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId);
  if (!result.changes) throw new Error('Riwayat percakapan tidak ditemukan.');
}
