const db = require('../config/db');

async function getPreferences(req, res) {
  const [rows] = await db.query('SELECT * FROM preferences WHERE user_id = :userId', { userId: req.userId });
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  return res.json({ preferences: rows[0] });
}

const ALLOWED = ['wake_phrase', 'response_length', 'response_mode', 'primary_use', 'memory_enabled', 'voice_enabled', 'tts_voice'];
const ENUMS = {
  response_length: ['short', 'balanced', 'detailed'],
  response_mode: ['voice', 'text', 'smart'],
  primary_use: ['study', 'coding', 'productivity', 'daily', 'conversation', 'everything']
};

async function updatePreferences(req, res) {
  const updates = req.body || {};
  if (updates.completeOnboarding !== undefined && typeof updates.completeOnboarding !== 'boolean') {
    return res.status(400).json({ error: 'invalid_preference', message: 'That onboarding choice is not valid.' });
  }
  const fields = [];
  const params = { userId: req.userId };

  for (const key of ALLOWED) {
    if (key in updates) {
      if (ENUMS[key] && !ENUMS[key].includes(updates[key])) {
        return res.status(400).json({ error: 'invalid_preference', message: `Choose a valid ${key.replace('_', ' ')} option.` });
      }
      if (['memory_enabled', 'voice_enabled'].includes(key) && typeof updates[key] !== 'boolean' && ![0, 1].includes(updates[key])) {
        return res.status(400).json({ error: 'invalid_preference', message: 'Choose on or off for that setting.' });
      }
      if (key === 'tts_voice' && updates[key] !== null && (typeof updates[key] !== 'string' || updates[key].length > 60)) {
        return res.status(400).json({ error: 'invalid_preference', message: 'That voice setting is not valid.' });
      }
      fields.push(`${key} = :${key}`);
      params[key] = updates[key];
    }
  }

  if (updates.wake_phrase !== undefined) {
    if (typeof updates.wake_phrase !== 'string') return res.status(400).json({ error: 'invalid_wake_phrase', message: 'Enter a wake phrase that includes a word before SACHIN.' });
    const phrase = updates.wake_phrase.trim();
    if (!phrase || phrase.length > 60 || !/\bsachin\b/i.test(phrase) || phrase.toLowerCase().indexOf('sachin') === 0) {
      return res.status(400).json({
        error: 'invalid_wake_phrase',
        message: 'Your wake phrase needs a word or phrase before "SACHIN" — the name itself never changes.'
      });
    }
    params.wake_phrase = phrase;
  }

  if (!fields.length) {
    if (!updates.completeOnboarding) return res.status(400).json({ error: 'no_updates' });
  }

  if (fields.length) await db.query(`UPDATE preferences SET ${fields.join(', ')} WHERE user_id = :userId`, params);

  if (updates.completeOnboarding === true) {
    await db.query('UPDATE users SET onboarded = TRUE WHERE id = :userId', { userId: req.userId });
  }

  const [rows] = await db.query('SELECT * FROM preferences WHERE user_id = :userId', { userId: req.userId });
  return res.json({ preferences: rows[0] });
}

module.exports = { getPreferences, updatePreferences };
