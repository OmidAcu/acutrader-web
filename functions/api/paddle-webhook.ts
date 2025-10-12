export const onRequestPost: PagesFunction<{ DB: D1Database }> = async (ctx) => {
  const { request, env } = ctx;

  // --- (1) Parse body
  let payload: any;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response('invalid json', { status: 400 });
  }

  // --- (2) (Sandbox) Skip signature verification for now
  // TODO: Add Paddle v2 webhook signature verification using their public key
  // (v2 sends 'paddle-signature' headers; verify with Paddle's RSA public key)

  // --- (3) Persist raw event
  const type = payload?.event_type || payload?.type || 'unknown';
  await env.DB.prepare(
    'INSERT INTO events (type, body) VALUES (?1, ?2)'
  ).bind(type, JSON.stringify(payload)).run();

  // --- (4) Extract useful fields (v2 transactions)
  // v2 example-ish shape: payload.data contains transaction, customer, items, etc.
  const tx = payload?.data ?? payload; // be tolerant
  const customerEmail =
    tx?.customer?.email ||
    tx?.customer_email ||
    tx?.user?.email ||
    null;

  // Price/item data
  const priceId = tx?.items?.[0]?.price?.id || tx?.items?.[0]?.price_id || null;
  const transactionId = tx?.id || tx?.transaction_id || null;
  const status = tx?.status || payload?.status || 'pending';

  // Derive our product label from button used (we’ll pass it later via passthrough),
  // for now infer from priceId suffixes you set up ('nt','tv','dual') if you encode them
  let productLabel = 'unknown';
  if (priceId?.includes('nt')) productLabel = 'nt';
  else if (priceId?.includes('tv')) productLabel = 'tv';
  else if (priceId) productLabel = 'dual'; // fallback if you know mapping

  if (!customerEmail) {
    return new Response('ok (no email in payload)', { status: 200 });
  }

  // --- (5) Upsert customer
  await env.DB.prepare(
    'INSERT INTO customers (email) VALUES (?1) ON CONFLICT(email) DO NOTHING'
  ).bind(customerEmail).run();

  const customerRow = await env.DB.prepare(
    'SELECT id FROM customers WHERE email=?1'
  ).bind(customerEmail).first<{ id: number }>();

  if (!customerRow) {
    return new Response('customer upsert failed', { status: 500 });
  }

  // --- (6) Upsert subscription by transaction id
  if (transactionId) {
    await env.DB.prepare(
      `INSERT INTO subscriptions (customer_id, paddle_transaction_id, product_label, price_id, status)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(paddle_transaction_id) DO UPDATE SET status=excluded.status`
    )
      .bind(customerRow.id, transactionId, productLabel, priceId, status)
      .run();
  }

  // --- (7) License provisioning (very simple placeholder)
  // When a transaction becomes 'completed' (or 'billed'), create a license record.
  if (['completed', 'paid', 'billed', 'active'].includes(String(status).toLowerCase())) {
    // Check if license exists
    const existing = await env.DB.prepare(
      'SELECT id FROM licenses WHERE customer_id=?1 AND platform=?2'
    ).bind(customerRow.id, productLabel === 'dual' ? 'dual' : productLabel).first();

    if (!existing) {
      const licenseKey = cryptoRandom(24); // 24-char token
      await env.DB.prepare(
        'INSERT INTO licenses (customer_id, platform, license_key, status) VALUES (?1, ?2, ?3, ?4)'
      ).bind(
        customerRow.id,
        productLabel === 'dual' ? 'dual' : productLabel,
        licenseKey,
        'active'
      ).run();
      // TODO: send email via ConvertKit/Brevo with license & instructions
    }
  }

  return new Response('ok', { status: 200 });
};

// Small helper for random keys
function cryptoRandom(len: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/// <reference types="@cloudflare/workers-types" />

interface Env { DB: D1Database }

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // Read body (works for both GET with no body and POST with JSON)
  const raw = await request.text().catch(() => "");
  let eventType = `webhook:${request.method.toLowerCase()}`;

  // Try to detect Paddle event type from JSON
  if (raw) {
    try {
      const data = JSON.parse(raw);
      // Paddle v2 test events usually include "event_type" or "type"
      const candidate = data?.event_type ?? data?.type;
      if (typeof candidate === "string" && candidate.length) {
        eventType = candidate;
      }
    } catch {
      // keep eventType as webhook:get/post
    }
  }

  await env.DB
    .prepare("INSERT INTO events (type, body) VALUES (?1, ?2)")
    .bind(eventType, raw || "{}")
    .run();

  return new Response("ok", { status: 200 });
};
