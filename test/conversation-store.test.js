import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerUser } from '../lib/auth.js';
import { addConversationEntry, deleteConversation, getConversation, listConversations } from '../lib/conversation-store.js';
import { closeDatabase } from '../lib/database.js';

test('menyimpan riwayat percakapan terpisah untuk setiap pengguna', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mikrotik-conversation-'));
  process.env.DATABASE_PATH = path.join(directory, `${crypto.randomUUID()}.db`);
  try {
    const owner = registerUser({ name: 'Pemilik Riwayat', email: 'history-owner@example.test', password: 'password-kuat' });
    const other = registerUser({ name: 'Pengguna Lain', email: 'history-other@example.test', password: 'password-kuat' });
    const firstPlan = { id: 'plan-1', summary: 'Mengatur DNS.', warnings: [], actions: [{ title: 'Set DNS', cli: '/ip dns set servers=1.1.1.1' }], script: '/ip dns set servers=1.1.1.1' };
    const created = addConversationEntry({ userId: owner.id, prompt: 'Atur DNS router menggunakan 1.1.1.1', plan: firstPlan });
    addConversationEntry({ userId: owner.id, conversationId: created.id, prompt: 'Tambahkan DNS cadangan 8.8.8.8', plan: { ...firstPlan, id: 'plan-2' } });

    const summaries = listConversations(owner.id);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].entryCount, 2);
    assert.match(summaries[0].title, /Atur DNS router/);
    assert.deepEqual(listConversations(other.id), []);

    const conversation = getConversation(created.id, owner.id);
    assert.equal(conversation.entries.length, 2);
    assert.equal(conversation.entries[1].plan.id, 'plan-2');
    assert.throws(() => getConversation(created.id, other.id), /tidak ditemukan/);
    assert.throws(() => deleteConversation(created.id, other.id), /tidak ditemukan/);
    deleteConversation(created.id, owner.id);
    assert.deepEqual(listConversations(owner.id), []);
  } finally {
    closeDatabase();
    delete process.env.DATABASE_PATH;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
