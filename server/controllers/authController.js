const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const db = require('../config/db');

function sign(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d'
  });
}

async function register(req, res) {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'missing_fields', message: 'I need a name, email, and password to set up your account.' });
  }
  if (name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
    return res.status(400).json({ error: 'invalid_fields', message: 'Check your name and email address, then try again.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'weak_password', message: 'Use a password between 8 and 128 characters.' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = :email', { email });
    if (existing.length) {
      return res.status(409).json({ error: 'email_taken', message: "That email's already got a SACHIN account. Try signing in instead." });
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'INSERT INTO users (id, name, email, password_hash) VALUES (:id, :name, :email, :passwordHash)',
        { id, name, email, passwordHash }
      );
      await connection.query('INSERT INTO preferences (user_id) VALUES (:id)', { id });
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const token = sign(id);
    return res.status(201).json({ token, user: { id, name, email, plan: 'free', onboarded: false } });
  } catch (err) {
    console.error('register error:', err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email_taken', message: "That email's already got a SACHIN account. Try signing in instead." });
    return res.status(500).json({ error: 'server_error', message: "I couldn't set up your account right now. Give me a second and try again." });
  }
}

async function login(req, res) {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_fields', message: 'I need your email and password.' });
  }
  if (password.length > 128) return res.status(401).json({ error: 'invalid_credentials', message: "That email/password combo doesn't match anything I have." });

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = :email', { email });
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials', message: "That email/password combo doesn't match anything I have." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid_credentials', message: "That email/password combo doesn't match anything I have." });
    }

    const token = sign(user.id);
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan, onboarded: !!user.onboarded }
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'server_error', message: "I couldn't sign you in right now. Give me a second and try again." });
  }
}

async function me(req, res) {
  const [rows] = await db.query('SELECT id, name, email, plan, onboarded FROM users WHERE id = :id', { id: req.userId });
  if (!rows.length) return res.status(404).json({ error: 'not_found' });
  return res.json({ user: { ...rows[0], onboarded: !!rows[0].onboarded } });
}

async function deleteAccount(req, res) {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) return res.status(400).json({ error: 'password_required', message: 'Enter your password to permanently clear this account.' });
  const [rows] = await db.query('SELECT password_hash FROM users WHERE id = :id', { id: req.userId });
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'That password does not match this account.' });
  }
  await db.query('DELETE FROM users WHERE id = :id', { id: req.userId });
  return res.json({ ok: true });
}

module.exports = { register, login, me, deleteAccount };
