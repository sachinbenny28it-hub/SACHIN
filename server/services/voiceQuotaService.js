const db = require('../config/db');

const FREE_DAILY_VOICE_LIMIT = 5;

async function consumeFreeVoiceTurn(userId, executor = db) {
  await executor.query(
    `INSERT INTO daily_voice_usage (user_id, usage_date, turns)
     VALUES (:userId, UTC_DATE(), 0)
     ON DUPLICATE KEY UPDATE turns = turns`,
    { userId }
  );
  const [result] = await executor.query(
    `UPDATE daily_voice_usage SET turns = turns + 1
     WHERE user_id = :userId AND usage_date = UTC_DATE() AND turns < :limit`,
    { userId, limit: FREE_DAILY_VOICE_LIMIT }
  );
  return result.affectedRows === 1;
}

async function claimVoiceReservation(userId, id, transcriptHash, plan) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT quota_charged FROM voice_reservations
       WHERE id = :id AND user_id = :userId AND transcript_hash = :transcriptHash
         AND expires_at > UTC_TIMESTAMP() AND used_at IS NULL FOR UPDATE`,
      { id, userId, transcriptHash }
    );
    if (!rows.length) { await connection.rollback(); return 'invalid'; }

    if (!rows[0].quota_charged && plan !== 'pro') {
      const allowed = await consumeFreeVoiceTurn(userId, connection);
      if (!allowed) { await connection.rollback(); return 'limit'; }
    }

    await connection.query(
      'UPDATE voice_reservations SET used_at = UTC_TIMESTAMP() WHERE id = :id AND user_id = :userId',
      { id, userId }
    );
    await connection.commit();
    return 'claimed';
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally { connection.release(); }
}

module.exports = { FREE_DAILY_VOICE_LIMIT, consumeFreeVoiceTurn, claimVoiceReservation };
