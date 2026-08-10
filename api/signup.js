// POST /api/signup - creates the Firebase Auth user AND the tenants/{uid}
// doc in one step.
const { auth } = require('../lib/firebase');
const { createTenant } = require('../lib/firestore');
const { endpoint, readJson, sendErr } = require('../lib/http');

module.exports = endpoint(['POST'], async (req, res, { log }) => {
  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim() || email.split('@')[0] || 'My server';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return sendErr(res, 400, 'BAD_INPUT', 'a valid email is required');
  }
  if (password.length < 8 || password.length > 128) {
    return sendErr(res, 400, 'BAD_INPUT', 'password must be 8-128 characters');
  }

  try {
    const user = await auth.createUser({ email, password });
    // Open access: new accounts are active immediately — no payment required.
    // The `active` flag + 402 pay-gate remain in the code as the dormant Stripe
    // seam; flip this back to `active:false` (or let Stripe set it) to charge.
    try {
      await createTenant(user.uid, { name, active: true });
    } catch (tenantErr) {
      // Roll back the auth user, or the email is orphaned forever:
      // registered in Auth (409 on retry) with no tenant doc (404 everywhere).
      await auth.deleteUser(user.uid).catch(() => {});
      throw tenantErr;
    }
    log('log', { msg: 'tenant created', uid: user.uid, active: true });
    return res.status(200).json({ ok: true, uid: user.uid });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      return sendErr(res, 409, 'EMAIL_TAKEN', 'email already registered');
    }
    if (err.code === 'auth/invalid-password' || err.code === 'auth/invalid-email') {
      return sendErr(res, 400, 'BAD_INPUT', 'invalid email or password');
    }
    log('error', { msg: 'signup failed', err: err.message });
    return sendErr(res, 500, 'INTERNAL', 'signup failed');
  }
});
