const { randomUUID } = require('crypto');
const db = require('../config/db');

async function list(req, res) {
  const [goals] = await db.query(
    'SELECT id, title, due_date, status, created_at FROM goals WHERE user_id = :userId ORDER BY status = \'active\' DESC, due_date IS NULL, due_date ASC, created_at DESC',
    { userId: req.userId }
  );
  res.json({ goals });
}

async function create(req, res) {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const dueDate = req.body?.due_date || null;
  if (!title || title.length > 200) return res.status(400).json({ error: 'invalid_goal', message: 'A goal needs a title under 200 characters.' });
  if (dueDate !== null && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`)) || new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate)) {
    return res.status(400).json({ error: 'invalid_due_date', message: 'Choose a valid due date.' });
  }
  const id = randomUUID();
  await db.query('INSERT INTO goals (id, user_id, title, due_date) VALUES (:id, :userId, :title, :dueDate)', { id, userId: req.userId, title, dueDate });
  res.status(201).json({ goal: { id, title, due_date: dueDate, status: 'active' } });
}

async function update(req, res) {
  const { status } = req.body || {};
  if (!['active', 'done', 'dropped'].includes(status)) return res.status(400).json({ error: 'invalid_status', message: 'Choose active, done, or dropped.' });
  await db.query('UPDATE goals SET status = :status WHERE id = :id AND user_id = :userId', { id: req.params.id, userId: req.userId, status });
  res.json({ ok: true });
}

async function remove(req, res) {
  await db.query('DELETE FROM goals WHERE id = :id AND user_id = :userId', { id: req.params.id, userId: req.userId });
  res.json({ ok: true });
}

module.exports = { list, create, update, remove };
