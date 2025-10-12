// functions/api/paddle-webhook.ts
/// <reference types="@cloudflare/workers-types" />

interface Env { DB: D1Database }

/**
 * Paddle v2 webhook (POST-only)
 * - Logs raw event to `events`
 * - Extracts basic fields
 * - Upserts customer / subscription
 * - Creates a simple license when status indicates payment success
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // --- (1) Read raw body and parse JSON
  const raw = await request.text().catch(() => "");
  let payload: any;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // --- (2) Persist raw event
  const eventType = payload?.event_type ?? payload?.type ?? "transaction";
  await env.DB
    .prepare("INSERT INTO events (type, body) VALUES (?1, ?2)")
    .bind(eventType, raw || "{}")
    .run();

  // --- (3) Extract useful fields (be tolerant to shape)
  const tx = payload?.data ?? payload; // Paddle v2 often nests under data
  const customerEmail =
    tx?.customer?.email ??
    tx?.customer_email ??
    tx?.user?.email ??
    null;

  const priceId =
    tx?.items?.[0]?.price?.id ??
    tx?.items?.[0]?.price_id ??
    null;

  const transactionId = tx?.id ?? tx?.transaction_id ?? null;
  const status = String(
    tx?.status ?? payload?.status ?? "pending"
  ).toLowerCase();

  // Simple heuristic for product label (adjust to your mapping later)
  let productLabel: "nt" | "tv" | "dual" | "unknown" = "unknown";
  if (typeof priceId === "string") {
    if (priceId.includes("nt")) productLabel = "nt";
    else if (priceId.includes("tv")) productLabel = "tv";
    else if (priceId.includes("dual")) productLabel = "dual";
  }

  // If we cannot resolve a customer email, nothing else to do
  if (!customerEmail) {
    return new Response("ok (no email in payload)", { status: 200 });
  }

  // --- (4) Upsert customer
  await env.DB
    .prepare(
      "INSERT INTO customers (email) VALUES (?1) ON CONFLICT(email) DO NOTHING"
    )
    .bind(customerEmail)
    .run();

  const customerRow = await env.DB
    .prepare("SELECT id FROM customers WHERE email=?1")
    .bind(customerEmail)
    .first<{ id: number }>();

  if (!customerRow) {
    return new Response("customer upsert failed", { status: 500 });
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

  // --- (6) Very simple license provisioning
  // Trigger on success-like statuses; adjust to your final state machine.
  if (["completed", "paid", "billed", "active"].includes(status)) {
    const platform = productLabel === "dual" ? "dual" : productLabel;

    if (platform !== "unknown") {
      const existing = await env.DB
        .prepare(
          "SELECT id FROM licenses WHERE customer_id=?1 AND platform=?2"
        )
        .bind(customerRow.id, platform)
        .first<{ id: number }>();

      if (!existing) {
        const licenseKey = cryptoRandom(24); // 24-char token
        await env.DB
          .prepare(
            "INSERT INTO licenses (customer_id, platform, license_key, status) VALUES (?1, ?2, ?3, ?4)"
          )
          .bind(customerRow.id, platform, licenseKey, "active")
          .run();

        // TODO: send onboarding email (ConvertKit/Brevo) with license + instructions
      }
    }
  }

  return new Response("ok", { status: 200 });
};

// Helper to generate URL-safe-ish random keys (Workers runtime provides `crypto`)
function cryptoRandom(len: number) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
