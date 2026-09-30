const { randomUUID } = require('crypto');
const db = require('../config/db');

const FREE_MEMORY_LIMIT = 25; // active memories kept for free plan
const PRO_MEMORY_LIMIT = 400;

async function listMemories(userId) {
  const [rows] = await db.query(
    'SELECT * FROM memories WHERE user_id = :userId ORDER BY approved ASC, pinned DESC, updated_at DESC',
    { userId }
  );
  return rows;
}

/**
 * Pull only the memories relevant to the current message + mode, instead of
 * sending the user's whole memory vault on every request. Pinned memories
 * (goals/projects the user marked important) always ride along; the rest are
 * scored by simple keyword overlap with the current message.
 */
async function retrieveRelevantMemories(userId, currentMessage, { limit = 12 } = {}) {
  const all = (await listMemories(userId)).filter((memory) => !!memory.approved);
  const pinned = all.filter((m) => m.pinned);
  const rest = all.filter((m) => !m.pinned);

  const messageWords = new Set(
    currentMessage.toLowerCase().match(/[a-z0-9]+/g) || []
  );

  const scored = rest
    .map((m) => {
      const memWords = m.content.toLowerCase().match(/[a-z0-9]+/g) || [];
      const overlap = memWords.filter((w) => messageWords.has(w)).length;
      return { memory: m, score: overlap };
    })
    .sort((a, b) => b.score - a.score || new Date(b.memory.updated_at) - new Date(a.memory.updated_at));

  const remainingSlots = Math.max(limit - pinned.length, 0);
  const topScored = scored.slice(0, remainingSlots).map((s) => s.memory);

  return [...pinned, ...topScored].slice(0, limit);
}

function planLimit(plan) { return plan === 'pro' ? PRO_MEMORY_LIMIT : FREE_MEMORY_LIMIT; }

async function saveMemory(userId, { category, content, source = 'sachin_suggested', pinned = false }, plan = 'free') {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // Avoid near-duplicate memories.
  const [existing] = await db.query(
    'SELECT id FROM memories WHERE user_id = :userId AND content = :content LIMIT 1',
    { userId, content: trimmed }
  );
  if (existing.length) return existing[0].id;

  const limit = planLimit(plan);
  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) as count FROM memories WHERE user_id = :userId',
    { userId }
  );
  if (count >= limit) {
    const err = new Error(plan === 'pro'
      ? 'Your Memory Vault is full. Delete a memory before adding another.'
      : 'Your free Memory Vault is full. Delete a memory or upgrade to SACHIN Pro for more room.');
    err.status = 403;
    err.code = 'memory_limit_reached';
    err.expose = true;
    throw err;
  }

  const id = randomUUID();
  await db.query(
    'INSERT INTO memories (id, user_id, category, content, source, approved, pinned) VALUES (:id, :userId, :category, :content, :source, TRUE, :pinned)',
    { id, userId, category, content: trimmed, source, pinned }
  );
  return id;
}

async function updateMemory(userId, memoryId, updates) {
  const allowedCategories = ['goal', 'learning', 'project', 'preference', 'plan', 'instruction', 'context', 'behaviour'];
  if (updates.category !== undefined && !allowedCategories.includes(updates.category)) {
    const err = new Error('Choose a valid memory category.'); err.status = 400; err.expose = true; throw err;
  }
  if (updates.content !== undefined && (typeof updates.content !== 'string' || !updates.content.trim() || updates.content.trim().length > 500)) {
    const err = new Error('Memory notes must be between 1 and 500 characters.'); err.status = 400; err.expose = true; throw err;
  }
  if (updates.pinned !== undefined && ![true, false, 0, 1].includes(updates.pinned)) {
    const err = new Error('Pin status must be on or off.'); err.status = 400; err.expose = true; throw err;
  }
  if (updates.approved !== undefined && ![true, false, 0, 1].includes(updates.approved)) {
    const err = new Error('Approval status must be on or off.'); err.status = 400; err.expose = true; throw err;
  }
  const fields = [];
  const params = { userId, memoryId };
  for (const key of ['category', 'content', 'pinned', 'approved']) {
    if (key in updates) {
      fields.push(`${key} = :${key}`);
      params[key] = key === 'content' ? updates[key].trim() : updates[key];
    }
  }
  if (!fields.length) return;
  await db.query(
    `UPDATE memories SET ${fields.join(', ')} WHERE id = :memoryId AND user_id = :userId`,
    params
  );
}

async function deleteMemory(userId, memoryId) {
  await db.query('DELETE FROM memories WHERE id = :memoryId AND user_id = :userId', { memoryId, userId });
}

async function clearAllMemories(userId) {
  await db.query('DELETE FROM memories WHERE user_id = :userId', { userId });
}

module.exports = {
  listMemories,
  retrieveRelevantMemories,
  saveMemory,
  updateMemory,
  deleteMemory,
  clearAllMemories
};
