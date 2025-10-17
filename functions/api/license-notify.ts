/// <reference types="@cloudflare/workers-types" />

interface Env {
  CONVERTKIT_API_KEY: string;     // secret
  CONVERTKIT_FORM_ID: string;     // plaintext
  LICENSE_NOTIFY_TOKEN: string;   // secret
}

type Payload = {
  token?: string;
  email?: string;
  license_key?: string;
  platform?: "nt" | "tv" | "dual" | string;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1) Basic auth gate
  let body: Payload;
  try {
    body = await request.json<Payload>();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (!body?.token || body.token !== env.LICENSE_NOTIFY_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }

  // 2) Validate required fields
  const email = (body.email || "").trim().toLowerCase();
  const licenseKey = (body.license_key || "").trim();
  const platform = (body.platform || "").trim();

  if (!email || !licenseKey || !platform) {
    return new Response("missing fields", { status: 400 });
  }

  // 3) Upsert subscriber in Kit (ConvertKit) and attach custom fields
  //    Using v3 subscriber create-with-form endpoint
  const formId = env.CONVERTKIT_FORM_ID;
  const apiKey = env.CONVERTKIT_API_KEY;

  const convertKitURL = `https://api.convertkit.com/v3/forms/${encodeURIComponent(
    formId
  )}/subscribe`;

  const payload = {
    api_key: apiKey,
    email,
    // Custom fields must exactly match the names you created in Kit:
    // "license_key" and "platform"
    fields: {
      license_key: licenseKey,
      platform,
    },
    // If you want to force the incentive email, pass "tags" or "cohort",
    // but generally the inline form + fields is enough.
  };

  const resp = await fetch(convertKitURL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return new Response(`kit error: ${text}`, { status: 502 });
  }

  // 4) Done
  return new Response("ok", { status: 200 });
};
