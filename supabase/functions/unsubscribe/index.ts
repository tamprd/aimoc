// =====================================================================
// AIMOC — unsubscribe (Supabase Edge Function, Deno)
// GET  ?t=<token>  → redirects to the website's unsubscribe page
// POST ?t=<token>  → RFC 8058 one-click unsubscribe (Gmail / Outlook button)
// Deploy with --no-verify-jwt.   Secret: SITE_URL
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://www.aimoc.com.au').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req => {
  const t = new URL(req.url).searchParams.get('t') || '';
  if (!UUID.test(t)) return new Response('Invalid link', { status: 400 });
  if (req.method === 'POST') {
    const { error } = await db.rpc('unsubscribe_contact', { token: t });
    return new Response(error ? 'Error' : 'Unsubscribed', { status: error ? 500 : 200 });
  }
  return Response.redirect(`${SITE_URL}/#/unsubscribe/${t}`, 302);
});
