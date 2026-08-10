// lib/crypto.js - AES-256-GCM for provider keys at rest.
// ENCRYPTION_KEY is 32 random bytes as 64 hex chars, set in Vercel env (or
// local .env). Ciphertext layout: base64(iv[12] | authTag[16] | ciphertext).
// Keys are decrypted ONLY inside the server function that calls the AI -
// never returned to a client, never logged.
const crypto = require('crypto');

function getKey() {
  const hex = process.env.ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be set to 64 hex characters (32 random bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decryptSecret(payload) {
  const buf = Buffer.from(String(payload), 'base64');
  if (buf.length < 29) throw new Error('invalid ciphertext');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
