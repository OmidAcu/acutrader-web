// functions/api/paddle-webhook.ts
/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  LICENSE_NOTIFY_TOKEN: string;
}

/** Utility: log to events table (best-effort, never throw) */
async function logEvent(
  env: Env,
  type: string,
  body: unknown
): Promise<void> {
  try {
    await env.DB
      .prepare('INSERT INTO events (type, body) VALUES (?1, ?2)')
      .bind(type, JSON.stringify(body ?? {}))
      .run();
  } catch {
    // swallow
  }
}

/**
 * Paddle v2 webhook (POST-only)
 * - Logs raw event to `events`
 * - Extracts basic fields
 * - Upserts customer / subscription
 * - Provisions license on success-like statuses
 * - Calls /api/license-notify to deliver the license via Kit and marks `notified`
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // --- (1) Read raw body and parse JSON
  const raw = await request.text().catch(() => '');
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    await logEvent(env, 'webhook.error', { reason: 'invalid json' });
    return new Response('invalid json', { status: 400 });
  }

  // --- (2) Persist raw event
  const eventType = payload?.event_type ?? payload?.type ?? 'transaction';
  await logEvent(env, eventType, payload);

  // --- (3) Extract useful fields (be tolerant to shape)
  const tx = payload?.data ?? payload; // Paddle v2 often nests under data
  const customerEmail: string | null =
    tx?.customer?.email ?? tx?.customer_email ?? tx?.user?.email ?? null;

  const priceId: string | null =
    tx?.items?.[0]?.price?.id ?? tx?.items?.[0]?.price_id ?? null;

  const transactionId: string | null = tx?.id ?? tx?.transaction_id ?? null;
  const status = String(tx?.status ?? payload?.status ?? 'pending').toLowerCase();

  // Simple heuristic for product label (adjust to your mapping later)
  let productLabel: 'nt' | 'tv' | 'dual' | 'unknown' = 'unknown';
  if (typeof priceId === 'string') {
    if (priceId.includes('nt')) productLabel = 'nt';
    else if (priceId.includes('tv')) productLabel = 'tv';
    else if (priceId.includes('dual')) productLabel = 'dual';
  }

  if (!customerEmail) {
    await logEvent(env, 'webhook.note', { note: 'no email in payload' });
    return new Response('ok (no email)', { status: 200 });
  }

  // --- (4) Upsert customer
  await env.DB
    .prepare('INSERT INTO customers (email) VALUES (?1) ON CONFLICT(email) DO NOTHING')
    .bind(customerEmail)
    .run();

  const customerRow = await env.DB
    .prepare('SELECT id FROM customers WHERE email=?1')
    .bind(customerEmail)
    .first<{ id: number }>();

  if (!customerRow) {
    await logEvent(env, 'webhook.error', { reason: 'customer upsert failed', email: customerEmail });
    return new Response('customer upsert failed', { status: 500 });
  }

  // --- (5) Upsert subscription by Paddle transaction id (if present)
  if (transactionId) {
    await env.DB
      .prepare(
        `INSERT INTO subscriptions (customer_id, paddle_transaction_id, product_label, price_id, status)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(paddle_transaction_id) DO UPDATE SET
           status = excluded.status,
           product_label = excluded.product_label,
           price_id = excluded.price_id`
      )
      .bind(customerRow.id, transactionId, productLabel, priceId, status)
      .run();
  }

  // --- (6) License provisioning on success-like statuses
  if (['completed', 'paid', 'billed', 'active'].includes(status)) {
    const platform = productLabel === 'dual' ? 'dual' : productLabel;

    if (platform !== 'unknown') {
      // See if a license already exists
      const existing = await env.DB
        .prepare('SELECT id, license_key, notified FROM licenses WHERE customer_id=?1 AND platform=?2')
        .bind(customerRow.id, platform)
        .first<{ id: number; license_key: string; notified: number }>();

      let licenseKey = existing?.license_key;

      // Create a new license if none exists
      if (!existing) {
        licenseKey = cryptoRandom(24);
        await env.DB
          .prepare('INSERT INTO licenses (customer_id, platform, license_key, status) VALUES (?1, ?2, ?3, ?4)')
          .bind(customerRow.id, platform, licenseKey, 'active')
          .run();

        await logEvent(env, 'license.created', { email: customerEmail, platform, licenseKey });
      }

      // Notify if not yet notified
      const needsNotify = !existing || (existing && Number(existing.notified) === 0);

      if (needsNotify && licenseKey) {
        const notifyPayload = {
          token: env.LICENSE_NOTIFY_TOKEN,
          email: customerEmail,
          license_key: licenseKey,
          platform,
        };

        await logEvent(env, 'notify.attempt', notifyPayload);

        try {
          const notifyRes = await fetch(`${new URL(request.url).origin}/api/license-notify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(notifyPayload),
          });

          if (notifyRes.ok) {
            await env.DB
              .prepare(
                `UPDATE licenses
                 SET notified = 1,
                     notified_at = datetime('now')
                 WHERE customer_id = ?1
                   AND platform     = ?2
                   AND license_key  = ?3`
              )
              .bind(customerRow.id, platform, licenseKey)
              .run();

            await logEvent(env, 'notify.ok', { email: customerEmail, platform });
          } else {
            const errText = await notifyRes.text().catch(() => '');
            await logEvent(env, 'notify.fail', { status: notifyRes.status, errText });
          }
        } catch (err: any) {
          await logEvent(env, 'notify.error', { message: String(err?.message ?? err) });
        }
      }
    }
  }

  return new Response('ok', { status: 200 });
};

// Helper to generate URL-safe-ish random keys (Workers runtime provides `crypto`)
function cryptoRandom(len: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
