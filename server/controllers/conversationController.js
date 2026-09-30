const { randomUUID } = require('crypto');
const db = require('../config/db');

const FREE_HISTORY_LIMIT = 10; // conversations visible on the free plan

async function list(req, res) {
  const [[user]] = await db.query('SELECT plan FROM users WHERE id = :id', { id: req.userId });
  const limitClause = user.plan === 'pro' ? '' : `LIMIT ${FREE_HISTORY_LIMIT}`;

  const [rows] = await db.query(
    `SELECT id, title, mode, updated_at FROM conversations WHERE user_id = :userId ORDER BY updated_at DESC ${limitClause}`,
    { userId: req.userId }
  );
  res.json({ conversations: rows });
}

async function create(req, res) {
  const { mode = 'friend', title = 'New conversation' } = req.body || {};
  if (!['friend', 'teacher', 'coding', 'coach', 'daily'].includes(mode)) return res.status(400).json({ error: 'invalid_mode', message: 'Choose one of SACHIN’s conversation modes.' });
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 160) return res.status(400).json({ error: 'invalid_title', message: 'Give this conversation a short title.' });
  const id = randomUUID();
  await db.query(
    'INSERT INTO conversations (id, user_id, title, mode) VALUES (:id, :userId, :title, :mode)',
    { id, userId: req.userId, title: title.trim(), mode }
  );
  res.status(201).json({ conversation: { id, title, mode } });
}

async function getMessages(req, res) {
  const { id } = req.params;
  const [conv] = await db.query('SELECT id FROM conversations WHERE id = :id AND user_id = :userId', { id, userId: req.userId });
  if (!conv.length) return res.status(404).json({ error: 'not_found' });

  const [[user]] = await db.query('SELECT plan FROM users WHERE id = :userId', { userId: req.userId });
  const historyLimit = user?.plan === 'pro' ? '' : 'LIMIT 40';
  const [messages] = await db.query(
    `SELECT role, content, input_type, created_at FROM messages WHERE conversation_id = :id ORDER BY created_at DESC ${historyLimit}`,
    { id }
  );
  messages.reverse();
  res.json({ messages });
}

async function remove(req, res) {
  await db.query('DELETE FROM conversations WHERE id = :id AND user_id = :userId', { id: req.params.id, userId: req.userId });
  res.json({ ok: true });
}

module.exports = { list, create, getMessages, remove };
