// =====================================================================
// AIMOC — resend-webhook (Supabase Edge Function, Deno)
// Receives Resend delivery events (Svix-signed) and updates delivery status.
// Deploy with --no-verify-jwt.   Secret: RESEND_WEBHOOK_SECRET (whsec_…)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';

const RANK: Record<string, number> = { queued: 0, sent: 1, delayed: 2, delivered: 3, opened: 4, clicked: 5 };
const MAP: Record<string, string> = {
  'email.sent': 'sent', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed',
  'email.opened': 'opened', 'email.clicked': 'clicked',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed',
};
const TERMINAL = new Set(['bounced', 'complained', 'failed']);

function b64ToBytes(b64: string) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
function bytesToB64(b: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(b))); }
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function verify(req: Request, payload: string) {
  const id = req.headers.get('svix-id'), ts = req.headers.get('svix-timestamp'), sig = req.headers.get('svix-signature');
  if (!SECRET || !id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', b64ToBytes(SECRET.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = bytesToB64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${payload}`)));
  return sig.split(' ').some(part => safeEqual(part.split(',')[1] || '', expected));
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const payload = await req.text();
  if (!(await verify(req, payload))) return new Response('Invalid signature', { status: 401 });

  const evt = JSON.parse(payload);
  const providerId: string | undefined = evt?.data?.email_id;
  const status = MAP[evt?.type];
  await db.from('email_events').insert({ provider_id: providerId, type: evt?.type, payload: evt });
  if (!providerId || !status) return new Response('ok');

  const { data: rec } = await db.from('campaign_recipients').select('id,status,contact_id').eq('provider_id', providerId).maybeSingle();
  if (!rec) return new Response('ok');

  // never downgrade (e.g. a late "delivered" after "opened"), terminal states win
  const keep = TERMINAL.has(rec.status) || (!TERMINAL.has(status) && (RANK[status] ?? 0) <= (RANK[rec.status] ?? 0));
  const now = new Date().toISOString();
  if (!keep) {
    const err = status === 'bounced' ? (evt.data?.bounce?.message || evt.data?.bounce?.type || 'Bounced') : status === 'failed' ? (evt.data?.failed?.reason || 'Failed') : null;
    await db.from('campaign_recipients').update({ status, last_event_at: now, ...(err ? { error: String(err).slice(0, 500) } : {}) }).eq('id', rec.id);
  } else {
    await db.from('campaign_recipients').update({ last_event_at: now }).eq('id', rec.id);
  }

  if (rec.contact_id) {
    const bounceType = String(evt.data?.bounce?.type || 'Permanent');
    if (status === 'bounced' && !/transient|temporary|soft/i.test(bounceType)) {
      await db.from('contacts').update({ bounced_at: now }).eq('id', rec.contact_id);
    }
    if (status === 'complained') {
      await db.from('contacts').update({ receive_council_comms: false, unsubscribed_at: now }).eq('id', rec.contact_id);
      await db.from('audit_log').insert({ action: 'unsubscribe', entity: 'contacts', entity_id: rec.contact_id, changes: { via: 'spam complaint' } });
    }
  }
  return new Response('ok');
});
