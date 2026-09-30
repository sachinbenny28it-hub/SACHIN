const memoryService = require('../services/memoryService');
const db = require('../config/db');
const CATEGORIES = ['goal', 'learning', 'project', 'preference', 'plan', 'instruction', 'context', 'behaviour'];

async function list(req, res) {
  const memories = await memoryService.listMemories(req.userId);
  res.json({ memories });
}

async function create(req, res) {
  const { category, content, pinned } = req.body || {};
  if (!CATEGORIES.includes(category) || typeof content !== 'string' || !content.trim() || content.trim().length > 500) {
    return res.status(400).json({ error: 'missing_fields', message: 'A memory needs a category and some content.' });
  }
  const [[user]] = await db.query('SELECT plan FROM users WHERE id = :id', { id: req.userId });
  const id = await memoryService.saveMemory(req.userId, { category, content, source: 'user_explicit', pinned: pinned === true }, user?.plan || 'free');
  res.status(201).json({ id });
}

async function update(req, res) {
  await memoryService.updateMemory(req.userId, req.params.id, req.body || {});
  res.json({ ok: true });
}

async function remove(req, res) {
  await memoryService.deleteMemory(req.userId, req.params.id);
  res.json({ ok: true });
}

async function clearAll(req, res) {
  await memoryService.clearAllMemories(req.userId);
  res.json({ ok: true });
}

module.exports = { list, create, update, remove, clearAll };
