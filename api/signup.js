// POST /api/signup - creates the Firebase Auth user AND the tenants/{uid}
// doc in one step. New customers start with active:false (locked) until
// activated - manually for now, by Stripe later.
const { auth } = require('../lib/firebase');
const { createTenant } = require('../lib/firestore');
const { readJson, applyCors } = require('../lib/http');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim() || email.split('@')[0] || 'My server';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'a valid email is required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const user = await auth.createUser({ email, password });
    await createTenant(user.uid, { name });
    console.log(`[signup] created tenant ${user.uid} (${email}) - active:false`);
    return res.status(200).json({ ok: true, uid: user.uid });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'email already registered' });
    }
    console.error(`[signup] ${err.message}`);
    return res.status(500).json({ error: 'signup failed' });
  }
};
