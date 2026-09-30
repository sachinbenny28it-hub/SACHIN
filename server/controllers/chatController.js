const { randomUUID } = require('crypto');
const db = require('../config/db');
const memoryService = require('../services/memoryService');
const { buildSystemPrompt } = require('../services/systemPrompt');
const localAi = require('../services/localAiService');
const { consumeFreeVoiceTurn, claimVoiceReservation } = require('../services/voiceQuotaService');
const { createHash } = require('crypto');

const HISTORY_TURNS = 16; // most recent messages pulled into context
const VALID_MODES = ['friend', 'teacher', 'coding', 'coach', 'daily'];
const DONT_REMEMBER = /^\s*(?:please\s+)?(?:don't|do not|never)\s+(?:remember|save|store|keep)\b|\b(?:please\s+)?(?:don't|do not|never)\s+(?:remember|save|store|keep)\s+(?:this|that|it|anything|what i|my|about)\b|\b(?:forget|erase|delete from memory)\s+(?:this|that|it|everything|all of that|what i|my)\b|\bi\s+(?:don't|do not)\s+want\s+you\s+to\s+(?:remember|save|store|keep)\b/i;

async function sendMessage(req, res) {
  const userId = req.userId;
  const { conversationId, mode: requestedMode, inputType = 'text', voiceReservationId } = req.body || {};
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!message) {
    return res.status(400).json({ error: 'empty_message', message: "Looks like that message came through empty — try again?" });
  }
  if (message.length > 8000) return res.status(413).json({ error: 'message_too_long', message: 'That message is a bit long for one turn. Try splitting it up.' });
  if (!['text', 'voice'].includes(inputType)) return res.status(400).json({ error: 'invalid_input_type', message: 'Choose text or voice input.' });
  if (voiceReservationId !== undefined && (typeof voiceReservationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(voiceReservationId))) {
    return res.status(400).json({ error: 'invalid_voice_reservation', message: 'That voice transcript expired. Please try speaking again.' });
  }
  if (voiceReservationId && inputType !== 'voice') return res.status(400).json({ error: 'invalid_voice_reservation', message: 'A voice reservation can only be used with a voice message.' });
  if (requestedMode !== undefined && !VALID_MODES.includes(requestedMode)) return res.status(400).json({ error: 'invalid_mode', message: 'Choose one of SACHIN’s conversation modes.' });
  const doNotRemember = DONT_REMEMBER.test(message);
  let createdConvoId = null;

  try {
    const [[user]] = await db.query('SELECT name, plan FROM users WHERE id = :id', { id: userId });
    const [[prefs]] = await db.query('SELECT * FROM preferences WHERE user_id = :id', { id: userId });

    if (inputType === 'voice') {
      if (voiceReservationId) {
        const transcriptHash = createHash('sha256').update(message.toLowerCase().trim()).digest('hex');
        const claim = await claimVoiceReservation(userId, voiceReservationId, transcriptHash, user.plan);
        if (claim === 'invalid') return res.status(400).json({ error: 'invalid_voice_reservation', message: 'That voice transcript expired. Please try speaking again.' });
        if (claim === 'limit') return res.status(429).json({ error: 'voice_limit_reached', message: 'You’ve used today’s free voice turns. Text chat is still open, or SACHIN Pro gives you more voice time.' });
      } else if (user.plan !== 'pro') {
        const allowed = await consumeFreeVoiceTurn(userId);
        if (!allowed) {
          return res.status(429).json({ error: 'voice_limit_reached', message: 'You’ve used today’s free voice turns. Text chat is still open, or SACHIN Pro gives you more voice time.' });
        }
      }
    }

    // Resolve / create the conversation.
    let convoId = conversationId || null;
    let mode = requestedMode || 'friend';
    if (convoId) {
      const [rows] = await db.query('SELECT id, mode FROM conversations WHERE id = :id AND user_id = :userId', { id: convoId, userId });
      if (!rows.length) return res.status(404).json({ error: 'conversation_not_found' });
      if (requestedMode) {
        await db.query('UPDATE conversations SET mode = :mode WHERE id = :id AND user_id = :userId', { mode, id: convoId, userId });
      } else {
        mode = rows[0].mode;
      }
    } else if (!doNotRemember) {
      convoId = randomUUID();
      createdConvoId = convoId;
      await db.query('INSERT INTO conversations (id, user_id, title, mode) VALUES (:id, :userId, :title, :mode)', {
        id: convoId,
        userId,
        title: message.slice(0, 60),
        mode
      });
    }

    // ── Memory retrieval pipeline ──────────────────────────
    // 1. Temporary conversation context = recent message history
    const [history] = convoId ? await db.query(
      `SELECT role, content FROM messages WHERE conversation_id = :convoId ORDER BY created_at DESC LIMIT ${HISTORY_TURNS}`,
      { convoId }
    ) : [[]];
    history.reverse();

    // 2. Long-term relevant memories (not the whole vault)
    const memoriesEnabled = !!prefs.memory_enabled;
    const relevantMemories = doNotRemember || !memoriesEnabled ? [] : await memoryService.retrieveRelevantMemories(userId, message);
    const [activeGoals] = doNotRemember || !memoriesEnabled ? [[]] : await db.query(
      `SELECT title, due_date FROM goals
       WHERE user_id = :userId AND status = 'active'
       ORDER BY due_date IS NULL, due_date ASC, created_at DESC LIMIT 8`,
      { userId }
    );
    const systemPrompt = buildSystemPrompt({
      mode,
      responseLength: prefs.response_length,
      primaryUse: prefs.primary_use,
      memories: relevantMemories,
      goals: activeGoals,
      userName: user.name
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    if (doNotRemember) {
      messages.push({ role: 'system', content: 'The user asked you not to remember this message. Do not create a memory suggestion for it. This turn is private and will not be added to the SACHIN conversation history.' });
    }

    // 3. Ask SACHIN
    let modelReply;
    try {
      modelReply = await localAi.getSachinReply(messages, { allowMemorySuggestions: memoriesEnabled && !doNotRemember });
    } catch (err) {
      err.fromLocalAI = true;
      throw err;
    }
    const { text, suggestions } = modelReply;
    if (!text || !text.trim()) {
      const err = new Error('The AI returned an empty response.');
      err.fromLocalAI = true;
      throw err;
    }

    // Persist the turn.
    if (!doNotRemember) {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(
          'INSERT INTO messages (conversation_id, role, content, input_type) VALUES (:convoId, "user", :content, :inputType)',
          { convoId, content: message, inputType }
        );
        await connection.query(
          'INSERT INTO messages (conversation_id, role, content, input_type) VALUES (:convoId, "assistant", :content, "text")',
          { convoId, content: text }
        );
        await connection.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = :convoId', { convoId });
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally { connection.release(); }
    }

    return res.json({
      conversationId: convoId,
      reply: text,
      suggestions: doNotRemember ? [] : suggestions
    });
  } catch (err) {
    console.error('chat error:', { code: err.code || null, status: err.status || err.statusCode || null });
    if (createdConvoId) {
      try { await db.query('DELETE FROM conversations WHERE id = :id AND user_id = :userId', { id: createdConvoId, userId }); }
      catch (cleanupError) { console.error('conversation cleanup error:', cleanupError); }
    }
    if (err.code === 'OLLAMA_UNAVAILABLE') return res.status(503).json({ error: 'local_ai_unavailable', message: 'SACHIN’s free local AI is starting. Make sure Ollama is installed, then refresh and try again.' });
    if (err.code === 'OLLAMA_MODEL_MISSING') return res.status(503).json({ error: 'local_model_missing', message: `The local chat model is not installed yet. Open PowerShell in the SACHIN folder and run: ollama pull ${localAi.CHAT_MODEL}` });
    if (err.fromLocalAI || err.status) return res.status(503).json({ error: 'local_ai_unavailable', message: 'SACHIN could not get a reply from its local model. Check that Ollama is running and try again.' });
    if (/^ER_|^ECONN|^PROTOCOL_/.test(err.code || '')) return res.status(503).json({ error: 'database_unavailable', message: "I can’t reach your SACHIN data right now. Give me a moment, then try again." });
    return res.status(502).json({ error: 'ai_unavailable', message: "I couldn't reach my AI brain right now. Give me a second and try again." });
  }
}

module.exports = { sendMessage };
