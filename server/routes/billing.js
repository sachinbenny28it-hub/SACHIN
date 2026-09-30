const express = require('express');
const db = require('../config/db');

const router = express.Router();

// RevenueCat sends events with an `app_user_id` — set that to SACHIN's user id
// when you initialize the RevenueCat SDK on the client (see public/js/billing.js).
router.post('/revenuecat-webhook', express.json({ type: '*/*' }), async (req, res) => {
  if (!process.env.REVENUECAT_WEBHOOK_SECRET) {
    return res.status(503).json({ ok: false, message: 'Webhook secret is not configured.' });
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`) {
    return res.status(401).end();
  }

  const event = req.body?.event;
  if (!event) return res.status(400).end();

  const userId = event.app_user_id;
  const entitlements = event.entitlement_ids || [];
  const hasPro = Array.isArray(entitlements) && entitlements.includes('sachin_pro');
  const activeEvents = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED', 'REFUND_REVERSED'];

  try {
    if (typeof userId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      let plan = null;
      if (event.type === 'EXPIRATION' && hasPro) plan = 'free';
      else if (activeEvents.includes(event.type) && hasPro) plan = 'pro';
      // Cancellation only stops renewal. The user keeps Pro until an
      // EXPIRATION event confirms the entitlement has ended.
      if (plan) {
      await db.query('UPDATE users SET plan = :plan WHERE id = :userId', {
        userId,
          plan
      });
      }
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('revenuecat webhook error:', err);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
