const { createHash, randomUUID } = require('crypto');
const db = require('../config/db');
const localAi = require('../services/localAiService');
const { consumeFreeVoiceTurn } = require('../services/voiceQuotaService');

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

async function transcribe(req, res) {
  if (!req.file?.buffer?.length) return res.status(400).json({ error: 'audio_required', message: 'I didn’t receive a voice recording. Try speaking again.' });
  if (req.file.size > MAX_AUDIO_BYTES) return res.status(413).json({ error: 'audio_too_large', message: 'That recording is too long. Try a shorter voice message.' });

  try {
    const [[user]] = await db.query('SELECT plan FROM users WHERE id = :id', { id: req.userId });
    if (!user) return res.status(401).json({ error: 'not_authenticated', message: 'Please sign in again.' });

    const quotaCharged = user.plan !== 'pro';
    if (quotaCharged && !(await consumeFreeVoiceTurn(req.userId))) {
      return res.status(429).json({ error: 'voice_limit_reached', message: 'You’ve used today’s free voice turns. Text chat is still open, or SACHIN Pro gives you more voice time.' });
    }

    let transcript;
    try {
      transcript = (await localAi.transcribeAudio(req.file.buffer)).trim().slice(0, 8000);
    } catch (err) {
      err.fromLocalAI = true;
      throw err;
    }
    if (!transcript) return res.status(422).json({ error: 'empty_transcription', message: 'I couldn’t make out any words there. Try a shorter recording in a quieter place.' });

    const reservationId = randomUUID();
    const transcriptHash = createHash('sha256').update(transcript.toLowerCase().trim()).digest('hex');
    await db.query('DELETE FROM voice_reservations WHERE expires_at < UTC_TIMESTAMP() OR used_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)');
    await db.query(
      `INSERT INTO voice_reservations (id, user_id, transcript_hash, quota_charged, expires_at)
       VALUES (:id, :userId, :transcriptHash, :quotaCharged, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))`,
      { id: reservationId, userId: req.userId, transcriptHash, quotaCharged }
    );
    return res.json({ transcript, voiceReservationId: reservationId });
  } catch (err) {
    console.error('voice transcription error:', { code: err.code || null, status: err.status || err.statusCode || null });
    if (err.code === 'OLLAMA_UNAVAILABLE') return res.status(503).json({ error: 'local_ai_unavailable', message: 'SACHIN’s local speech recognizer is starting. Refresh and try again in a moment.' });
    if (err.code === 'OLLAMA_MODEL_MISSING') return res.status(503).json({ error: 'local_speech_model_missing', message: `The local speech model is not installed. Open PowerShell in the SACHIN folder and run: ollama pull ${localAi.ASR_MODEL}` });
    if (err.code === 'LOCAL_WAV_REQUIRED') return res.status(415).json({ error: 'unsupported_audio', message: 'This browser did not send a WAV recording. Try voice input in Chrome or Edge.' });
    if (err.fromLocalAI || err.status || err.statusCode) return res.status(503).json({ error: 'voice_unavailable', message: 'SACHIN could not transcribe that recording locally. Try again or use browser voice input.' });
    if (/^ER_|^ECONN|^PROTOCOL_/.test(err.code || '')) return res.status(503).json({ error: 'database_unavailable', message: 'I can’t reach your SACHIN data right now. Give me a moment, then try again.' });
    return res.status(500).json({ error: 'voice_unavailable', message: 'I couldn’t process that voice message just now. Try again.' });
  }
}

module.exports = { transcribe, MAX_AUDIO_BYTES };
