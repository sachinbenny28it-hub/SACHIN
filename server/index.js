require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./config/db');
const localAi = require('./services/localAiService');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const memoryRoutes = require('./routes/memory');
const preferencesRoutes = require('./routes/preferences');
const conversationRoutes = require('./routes/conversations');
const billingRoutes = require('./routes/billing');
const goalsRoutes = require('./routes/goals');
const voiceRoutes = require('./routes/voice');

const app = express();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'replace_this_with_a_long_random_string') {
  throw new Error('Set JWT_SECRET to a unique random value of at least 32 characters before starting SACHIN.');
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://js.stripe.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://*.revenuecat.com', 'https://*.stripe.com', 'https://*.paddle.com'],
      frameSrc: ["'self'", 'https://*.revenuecat.com', 'https://*.stripe.com', 'https://*.paddle.com'],
      formAction: ["'self'", 'https://*.revenuecat.com', 'https://*.stripe.com', 'https://*.paddle.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));
if (process.env.CLIENT_ORIGIN) {
  const allowedOrigins = process.env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({ origin: allowedOrigins, credentials: false }));
}
app.use('/api/billing', billingRoutes); // mounted before json() so it can set its own parser
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'too_many_attempts', message: 'There have been too many sign-in attempts. Take a few minutes, then try again.' })
}));
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/goals', goalsRoutes);

app.get('/api/config', (req, res) => res.json({
  revenueCatWebBillingKey: process.env.REVENUECAT_PUBLIC_API_KEY || null
}));

app.get('/vendor/revenuecat.js', (req, res, next) => {
  try { res.sendFile(require.resolve('@revenuecat/purchases-js')); }
  catch (err) { next(err); }
});

app.get('/api/health', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    const ai = await localAi.getLocalAiStatus();
    res.json({ ok: true, name: 'SACHIN', database: 'connected', aiProvider: ai.provider, aiModel: ai.model, aiConfigured: ai.chatReady, voiceConfigured: ai.voiceReady });
  } catch (err) { next(err); }
});

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback error handler — never leak raw stack traces to the client.
app.use((err, req, res, next) => {
  console.error(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({
    error: err.expose ? (err.code || 'request_error') : 'server_error',
    message: err.expose ? err.message : status < 500 ? 'That request did not come through right. Check it and try again.' : "I couldn't complete that just now. Give me a second and try again."
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SACHIN is listening on http://localhost:${PORT}`);
  localAi.ensureOllamaRunning().then((status) => {
    if (status.running) console.log(`Local AI service ready; chat model ${status.chatReady ? 'installed' : 'missing'}, voice model ${status.voiceReady ? 'installed' : 'missing'}.`);
    else console.log('Local AI service is not available yet. Install Ollama and keep it running to use chat.');
  }).catch((error) => console.error('Local AI startup check failed:', { code: error.code || null }));
});
