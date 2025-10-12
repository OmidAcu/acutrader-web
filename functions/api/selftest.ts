/// <reference types="@cloudflare/workers-types" />

interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  await env.DB
    .prepare('INSERT INTO events (type, body) VALUES (?1, ?2)')
    .bind('selftest', '{"ping":true}')
    .run();

  return new Response('selftest ok', { status: 200 });
};
