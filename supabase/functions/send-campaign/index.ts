// =====================================================================
// AIMOC — send-campaign (Supabase Edge Function, Deno)
//
// POST { campaign_id }                 → send to the resolved audience
// POST { campaign_id, test_to }        → send one [TEST] copy
// POST { run_scheduled: true }         → cron: send due scheduled campaigns
//                                        (requires header x-cron-secret)
//
// Secrets: RESEND_API_KEY, SITE_URL, CRON_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically)
// =====================================================================
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://www.aimoc.com.au').replace(/\/$/, '');
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const BATCH = 100;           // Resend batch limit
const PAUSE_MS = 600;        // stay under Resend's default 2 requests/second

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)));
  } catch { return {}; }
}

type Recipient = { contact_id: string | null; org_id: string | null; email: string; full_name: string; org_name: string; unsubscribe_token: string | null };
type Settings = Record<string, any>;
type Campaign = Record<string, any>;

function personalise(html: string, r: Recipient, plain = false) {
  const e = plain ? (x: string) => x : esc;
  const first = (r.full_name || '').trim().split(/\s+/)[0] || 'there';
  return html
    .split('{{first_name}}').join(e(first))
    .split('{{full_name}}').join(e(r.full_name || ''))
    .split('{{org_name}}').join(e(r.org_name || 'your organisation'));
}

function buildEmail(c: Campaign, s: Settings, r: Recipient) {
  const unsubPage = r.unsubscribe_token ? `${SITE_URL}/#/unsubscribe/${r.unsubscribe_token}` : `${SITE_URL}/#/contact`;
  const attachments = (c.attachments || []) as { name: string; url: string }[];
  const body = personalise(c.body_html || '', r);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#F3F4F5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${esc(c.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border:1px solid #D9DDE2;border-radius:8px;overflow:hidden">
<tr><td style="background:#0B0D0F;padding:16px 24px"><img src="${SITE_URL}/assets/email-logo.png" width="150" alt="${esc(s.short_name || 'AIMOC')}" style="display:block;border:0;height:auto"></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:#FFC400">&nbsp;</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.6;color:#1B1F24">${body}
${attachments.length ? `<p style="margin-top:20px"><strong>Attachments</strong><br>${attachments.map(a => `&#128206; <a href="${esc(a.url)}" style="color:#0B0D0F">${esc(a.name)}</a>`).join('<br>')}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;background:#F3F4F5;font-size:12px;line-height:1.5;color:#5E6670">
${esc(s.email_footer || s.council_name || '').replace(/\n/g, '<br>')}<br>
You're receiving this as a contact for ${esc(r.org_name || 'a member organisation')}.
<a href="${esc(unsubPage)}" style="color:#5E6670">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|li|div)>/gi, '\n').replace(/<li>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim()
    + (attachments.length ? '\n\nAttachments:\n' + attachments.map(a => `${a.name}: ${a.url}`).join('\n') : '')
    + `\n\n—\n${s.email_footer || s.council_name || ''}\nUnsubscribe: ${unsubPage}`;
  const headers: Record<string, string> = {};
  if (r.unsubscribe_token) {
    headers['List-Unsubscribe'] = `<${SUPABASE_URL}/functions/v1/unsubscribe?t=${r.unsubscribe_token}>` + (s.email_reply_to ? `, <mailto:${s.email_reply_to}?subject=unsubscribe>` : '');
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  return { html, text, headers };
}

function fromLine(s: Settings) {
  if (!s.email_from_address) throw new Error('Set the "From address" in Admin → Settings → Email first.');
  return `${(s.email_from_name || s.short_name || 'AIMOC').replace(/[<>"]/g, '')} <${s.email_from_address}>`;
}

async function resendBatch(emails: unknown[]) {
  if (!RESEND_KEY) throw new Error('Email sending is not configured (RESEND_API_KEY missing).');
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(emails),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.message || `Resend error ${res.status}`);
  return (out?.data || []) as { id: string }[];
}

async function sendCampaign(db: SupabaseClient, c: Campaign, s: Settings, actor: string | null) {
  const from = fromLine(s);
  const { data: audience, error: aErr } = await db.rpc('_campaign_audience', { a: { ...(c.audience || {}), category: c.category } });
  if (aErr) throw aErr;
  const list = (audience || []) as Recipient[];
  if (!list.length) throw new Error('Nobody matches this audience.');

  // queue recipients (idempotent)
  const queued = list.map(r => ({ campaign_id: c.id, contact_id: r.contact_id, org_id: r.org_id, email: r.email, full_name: r.full_name, org_name: r.org_name, status: 'queued' }));
  for (let i = 0; i < queued.length; i += 500) {
    const { error } = await db.from('campaign_recipients').upsert(queued.slice(i, i + 500), { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  const { data: rows, error: rErr } = await db.from('campaign_recipients').select('id,contact_id,email').eq('campaign_id', c.id).in('status', ['queued', 'failed']);
  if (rErr) throw rErr;
  const byContact = new Map(list.map(r => [r.contact_id, r]));

  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < (rows || []).length; i += BATCH) {
    const chunk = rows!.slice(i, i + BATCH);
    const emails = chunk.map(row => {
      const r = byContact.get(row.contact_id)!;
      const { html, text, headers } = buildEmail(c, s, r);
      return {
        from, to: [r.email], subject: personalise(c.subject, r, true),
        html, text, headers, ...(s.email_reply_to ? { reply_to: s.email_reply_to } : {}),
        tags: [{ name: 'campaign', value: String(c.id).replace(/-/g, '_') }],
      };
    });
    const now = new Date().toISOString();
    try {
      const ids = await resendBatch(emails);
      await Promise.all(chunk.map((row, k) => db.from('campaign_recipients')
        .update({ status: 'sent', provider_id: ids[k]?.id || null, sent_at: now, last_event_at: now }).eq('id', row.id)));
      sent += chunk.length;
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(msg);
      await db.from('campaign_recipients').update({ status: 'failed', error: msg, last_event_at: now }).in('id', chunk.map(r => r.id));
      failed += chunk.length;
    }
    if (i + BATCH < rows!.length) await sleep(PAUSE_MS);
  }

  const status = sent === 0 ? 'failed' : 'sent';
  await db.from('campaigns').update({
    status, sent_at: new Date().toISOString(), sent_by: actor, recipient_count: sent + failed,
    error: errors.length ? `${failed} failed: ${[...new Set(errors)].join('; ')}`.slice(0, 1000) : null,
  }).eq('id', c.id);
  await db.from('audit_log').insert({ actor, action: 'send', entity: 'campaigns', entity_id: c.id, changes: { sent, failed, audience: c.audience } });
  return { sent, failed };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  const { data: s } = await db.from('site_settings').select('*').eq('id', 1).single();
  if (!s) return json({ error: 'Settings missing' }, 500);

  // ---------- scheduled sends (cron) ----------
  if (body.run_scheduled) {
    // accept either the CRON_SECRET env secret or the one stored in Supabase Vault (used by pg_cron)
    const given = req.headers.get('x-cron-secret') || '';
    let ok = !!CRON_SECRET && given === CRON_SECRET;
    if (!ok && given) { const { data } = await db.rpc('cron_secret_ok', { p: given }); ok = data === true; }
    if (!ok) return json({ error: 'Forbidden' }, 403);
    const { data: due } = await db.from('campaigns').select('*').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString());
    const results = [];
    for (const c of due || []) {
      const { data: locked } = await db.from('campaigns').update({ status: 'sending' }).eq('id', c.id).eq('status', 'scheduled').select('id');
      if (!locked?.length) continue;
      try { results.push({ id: c.id, ...(await sendCampaign(db, c, s, c.approved_by)) }); }
      catch (e) {
        await db.from('campaigns').update({ status: 'failed', error: (e as Error).message }).eq('id', c.id);
        results.push({ id: c.id, error: (e as Error).message });
      }
    }
    return json({ ok: true, results });
  }

  // ---------- staff-initiated ----------
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: 'Please log in again.' }, 401);
  const { data: staff } = await db.from('staff').select('role,active').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!staff) return json({ error: 'Council staff only.' }, 403);
  if (s.require_admin_mfa && jwtClaims(token).aal !== 'aal2') return json({ error: 'Two-step verification required.' }, 403);

  const { data: c } = await db.from('campaigns').select('*').eq('id', body.campaign_id).maybeSingle();
  if (!c) return json({ error: 'Communication not found.' }, 404);
  if (!c.subject?.trim() || !c.body_html?.trim()) return json({ error: 'Add a subject and message first.' }, 400);

  try {
    // test send
    if (body.test_to) {
      const to = String(body.test_to).trim().toLowerCase();
      if (!isEmail(to)) return json({ error: 'Invalid test address.' }, 400);
      const r: Recipient = { contact_id: null, org_id: null, email: to, full_name: 'Test Recipient', org_name: 'Test Organisation', unsubscribe_token: null };
      const { html, text } = buildEmail(c, s, r);
      await resendBatch([{ from: fromLine(s), to: [to], subject: '[TEST] ' + personalise(c.subject, r, true), html, text, ...(s.email_reply_to ? { reply_to: s.email_reply_to } : {}) }]);
      await db.from('audit_log').insert({ actor: user.id, actor_email: user.email, action: 'test_send', entity: 'campaigns', entity_id: c.id, changes: { to } });
      return json({ ok: true });
    }

    // real send — approval rules
    // a failed send can be retried by whoever could have sent it (approval was already given)
    const allowed = c.status === 'approved' || (c.status === 'failed' && (!!c.approved_at || !s.require_comms_approval))
      || (!s.require_comms_approval && ['draft', 'cancelled'].includes(c.status));
    if (!allowed) return json({ error: s.require_comms_approval ? 'This communication must be approved by a Council Administrator first.' : `Can't send from status "${c.status}".` }, 403);

    const { data: locked } = await db.from('campaigns').update({ status: 'sending', sent_by: user.id }).eq('id', c.id).eq('status', c.status).select('id');
    if (!locked?.length) return json({ error: 'This communication is already being sent.' }, 409);
    const result = await sendCampaign(db, c, s, user.id);
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = (e as Error).message;
    await db.from('campaigns').update({ status: 'failed', error: msg }).eq('id', c.id).eq('status', 'sending');
    return json({ error: msg }, 500);
  }
});
