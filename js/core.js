/* =====================================================================
   AIMOC platform — core.js
   Supabase client, shared state, helpers, auth (magic link), router, layout
   ===================================================================== */

// ---- capture magic-link redirect details BEFORE supabase consumes them ----
const BOOT = (() => {
  const hash = location.hash;
  const qs = new URLSearchParams(location.search);
  const hp = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const r = { fromLink: /access_token=/.test(hash), recovery: hp.get('type') === 'recovery', next: qs.get('next'), notice: null };
  if (hp.get('error_description')) {
    r.notice = hp.get('error_code') === 'otp_expired'
      ? 'That link has expired or was already used. Log in, or use Forgot password to get a new one.'
      : hp.get('error_description');
    history.replaceState(null, '', location.pathname + '#/login');
  }
  return r;
})();

const CFG = window.AIMOC_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
});

const S = {
  session: null,
  staff: null,          // { role, active, mfa_required, aal }
  myContacts: [],       // contact rows linked to my login (+ organisation)
  settings: {},
  navPages: [],
  L: { categories: [], disciplines: [], roles: [], metrics: [], consentTypes: [], consentStatements: [] },
};

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = s => DOMPurify.sanitize(marked.parse(s || ''));
const cleanHtml = s => DOMPurify.sanitize(s || '', { ADD_ATTR: ['target'] });
const safeUrl = u => (/^(https?:|mailto:|#)/i.test(u || '') ? esc(u) : '#');
const slugify = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const toDate = d => new Date(String(d).length === 10 ? d + 'T00:00' : d);
const fmtDate = d => (d ? toDate(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const fmtNum = n => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-AU', { maximumFractionDigits: 1 }));
const toLocalDT = iso => { if (!iso) return ''; const d = new Date(iso); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const uniq = a => [...new Set(a)];
const byId = (list, id) => list.find(x => String(x.id) === String(id));
const nameOf = (list, id) => byId(list, id)?.name || '';
const orgName = o => (o ? o.trading_name || o.legal_name : '');

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const STATE_NAMES = { ACT: 'Australian Capital Territory', NSW: 'New South Wales', NT: 'Northern Territory', QLD: 'Queensland', SA: 'South Australia', TAS: 'Tasmania', VIC: 'Victoria', WA: 'Western Australia', National: 'National' };
const ANSWERS = { reported: 'Reported', not_applicable: 'Not applicable', unknown: 'Unknown', not_disclosed: 'Prefer not to disclose' };
const ROLE_LABELS = { super_admin: 'Super Administrator', council_admin: 'Council Administrator', comms_editor: 'Communications Editor', org_admin: 'Organisation Administrator', org_rep: 'Organisation Representative', none: 'No portal access' };

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}
const errMsg = e => e?.message || e?.error_description || String(e);
const fail = e => { console.error(e); toast(errMsg(e), 'err'); };

/** Throws on supabase error so callers can use try/catch */
const must = async q => { const { data, error } = await q; if (error) throw error; return data; };

function modal(html, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button class="modal-x" type="button" aria-label="Close">×</button>${html}</div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelector('.modal-x').onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  wrap.querySelector('input,select,textarea,button:not(.modal-x)')?.focus();
  return { el: wrap.querySelector('.modal'), close };
}

const _scripts = {};
function loadScript(src) {
  return (_scripts[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  }));
}
function loadCss(href) {
  if ($(`link[href="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function toCsv(rows, cols) {
  const cell = v => {
    const s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
  };
  return [cols.map(c => cell(c.label)).join(','), ...rows.map(r => cols.map(c => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\r\n');
}
const downloadCsv = (rows, cols, name) => downloadBlob(new Blob(['﻿' + toCsv(rows, cols)], { type: 'text/csv;charset=utf-8' }), name);

const publicUrl = (bucket, path) => (path ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : '');
const logoUrl = path => publicUrl('org-logos', path);

async function uploadFile(bucket, file, prefix) {
  const clean = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${prefix}/${Date.now()}-${clean}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

async function openDocument(path) {
  if (!path) return;
  if (path.startsWith('member-docs/')) {
    const { data, error } = await sb.storage.from('member-docs').createSignedUrl(path.slice(12), 300);
    if (error) return toast('You need to be logged in as a member to open this document.', 'err');
    window.open(data.signedUrl, '_blank', 'noopener');
  } else {
    window.open(publicUrl('public-docs', path.replace(/^public-docs\//, '')), '_blank', 'noopener');
  }
}

/* -------- form helpers -------- */
const chk = (name, value, checked, label, extra = '') =>
  `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} ${extra}> <span>${label}</span></label>`;
const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
const field = (label, input, hint = '') => `<label class="field"><span class="lbl">${label}</span>${input}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
const checkedValues = (root, name) => $$(`input[name="${name}"]:checked`, root).map(i => i.value);

/* ---------------- data ---------------- */
async function loadSettings() {
  const { data } = await sb.from('site_settings').select('*').eq('id', 1).maybeSingle();
  S.settings = data || {};
}
async function loadNav() {
  const { data } = await sb.from('pages').select('slug,title').eq('published', true).eq('show_in_nav', true).order('nav_order');
  S.navPages = data || [];
}
async function loadLookups(force = false) {
  if (!force && S.L.categories.length) return;
  const [c, d, r, m, ct, cs] = await Promise.all([
    sb.from('org_categories').select('*').order('sort').order('name'),
    sb.from('disciplines').select('*').order('sort').order('name'),
    sb.from('contact_roles').select('*').order('sort').order('name'),
    sb.from('stat_metrics').select('*').order('sort'),
    sb.from('consent_types').select('*').order('sort'),
    sb.from('consent_statements').select('*'),
  ]);
  S.L = { categories: c.data || [], disciplines: d.data || [], roles: r.data || [], metrics: m.data || [], consentTypes: ct.data || [], consentStatements: cs.data || [] };
}
const activeList = list => list.filter(x => x.active !== false);
const currentStatements = () => {
  const v = S.settings.consent_version;
  return S.L.consentTypes.map(t => ({ ...t, statement: S.L.consentStatements.find(s => s.version === v && s.consent_key === t.key)?.statement || '' }));
};

async function afterLogin() {
  if (!S.session) { S.staff = null; S.myContacts = []; return; }
  await sb.rpc('claim_my_contacts').then(() => {}, () => {});
  const [st, mc] = await Promise.all([
    sb.rpc('my_staff_status'),
    sb.from('contacts').select('id,org_id,full_name,email,is_principal,portal_access,receive_council_comms,unsubscribed_at,organisations(id,legal_name,trading_name,status,state)')
      .eq('user_id', S.session.user.id).eq('active', true),
  ]);
  S.staff = st.data || null;
  S.myContacts = mc.data || [];
}
const isStaffUser = () => !!S.staff?.active;
const staffRole = () => (S.staff?.active ? S.staff.role : null);
const canAdmin = () => ['super_admin', 'council_admin'].includes(staffRole());
const isSuper = () => staffRole() === 'super_admin';

/* ---------------- email + password login ---------------- */
const MIN_PW = 8;
function friendlyAuthError(err) {
  const m = errMsg(err);
  const secs = m.match(/after (\d+) seconds?/i);
  if (secs || /rate limit|security purposes/i.test(m)) return `Please wait ${secs ? secs[1] + ' seconds' : 'a moment'} and try again.`;
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email address first — check your inbox for the confirmation email.';
  if (/invalid.*email|email.*invalid/i.test(m)) return `That email address doesn't look right.`;
  if (/password.*(short|least|characters)|weak/i.test(m)) return `Choose a password of at least ${MIN_PW} characters.`;
  if (/same.*password|different from the old/i.test(m)) return 'Choose a password different from your current one.';
  return esc(m);
}
const authBack = next => location.origin + location.pathname + (next ? `?next=${encodeURIComponent(next)}` : '');
function startCooldown(btn, secs = 60, label = 'Resend email') {
  let n = secs; btn.disabled = true;
  const tick = () => {
    if (!btn.isConnected) return;
    if (n <= 0) { btn.disabled = false; btn.textContent = label; return; }
    btn.textContent = `${label} (${n}s)`; n--; setTimeout(tick, 1000);
  };
  tick();
}
const lastEmail = () => { try { return localStorage.getItem('aimoc_last_email') || ''; } catch { return ''; } };
const rememberEmail = e => { try { localStorage.setItem('aimoc_last_email', e); } catch {} };

/** Log in / create account / forgot password, in one box. mode: 'login' | 'signup' */
function authFormHtml({ id = 'authBox', mode = 'login', notice = '' } = {}) {
  return `<div class="card auth-box" id="${id}" data-mode="${mode}">
    ${notice ? `<p class="notice err">${esc(notice)}</p>` : ''}
    <div class="tabs auth-tabs" role="tablist"><button type="button" data-am="login">Log in</button><button type="button" data-am="signup">Create account</button></div>
    <form class="form" novalidate>
      <div class="form-error" hidden></div>
      ${field('Email address', `<input name="email" type="email" required autocomplete="email" value="${esc(lastEmail())}">`)}
      <div data-only="login signup">${field('Password', `<input name="password" type="password" required minlength="${MIN_PW}" autocomplete="current-password">`, '<span data-only="signup">At least ' + MIN_PW + ' characters.</span>')}</div>
      <div data-only="signup">${field('Confirm password', '<input name="password2" type="password" autocomplete="new-password">')}</div>
      <label class="check small" data-only="login signup"><input type="checkbox" data-showpw> <span>Show password</span></label>
      <button class="btn" type="submit"></button>
      <p class="small" data-only="login"><button class="linklike" type="button" data-am="forgot">Forgot password?</button></p>
      <p class="small muted" data-only="login">Logged in before with an email link? Use <strong>Forgot password</strong> to set a password.</p>
      <p class="small" data-only="forgot"><button class="linklike" type="button" data-am="login">← Back to log in</button></p>
    </form>
  </div>`;
}
function wireAuthForm(id = 'authBox', next = null) {
  const box = $('#' + id); if (!box) return;
  const form = $('form', box), errBox = $('.form-error', form), btn = $('button[type=submit]', form);
  const LABEL = { login: 'Log in', signup: 'Create account', forgot: 'Email me a reset link' };
  const setMode = m => {
    box.dataset.mode = m;
    $$('[data-only]', box).forEach(el => { el.hidden = !el.dataset.only.split(' ').includes(m); });
    $$('.auth-tabs [data-am]', box).forEach(b => b.classList.toggle('active', b.dataset.am === m || (m === 'forgot' && b.dataset.am === 'login')));
    form.password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    btn.textContent = LABEL[m]; errBox.hidden = true;
  };
  $$('[data-am]', box).forEach(b => b.onclick = () => setMode(b.dataset.am));
  $('[data-showpw]', box).onchange = e => { form.password.type = form.password2.type = e.target.checked ? 'text' : 'password'; };
  const showErr = html => { errBox.innerHTML = html; errBox.hidden = false; };
  const sentPanel = (title, html, resend) => {
    form.hidden = true; $('.auth-tabs', box).hidden = true;
    const p = document.createElement('div'); p.className = 'sent';
    p.innerHTML = `<div class="sent-icon" aria-hidden="true">✉</div><h2>${title}</h2>${html}
      <p class="hint">Not there after a minute? Check spam or junk.</p>
      <div class="row center"><button class="btn ghost" type="button" data-resend>Resend email</button></div><p class="small" data-msg></p>
      <button class="linklike small" type="button" data-back>← Back to log in</button>`;
    box.append(p);
    const rb = $('[data-resend]', p); startCooldown(rb);
    rb.onclick = async () => { rb.disabled = true; const { error } = await resend(); $('[data-msg]', p).innerHTML = error ? `<span class="bad">${friendlyAuthError(error)}</span>` : '<span class="good">Sent again — use the newest email.</span>'; startCooldown(rb); };
    $('[data-back]', p).onclick = () => { p.remove(); form.hidden = false; $('.auth-tabs', box).hidden = false; setMode('login'); };
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const m = box.dataset.mode, email = form.email.value.trim().toLowerCase(), pw = form.password.value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr(`That email address doesn't look right.`);
    if (m !== 'forgot' && !pw) return showErr('Enter your password.');
    if (m === 'signup') {
      if (pw.length < MIN_PW) return showErr(`Choose a password of at least ${MIN_PW} characters.`);
      if (pw !== form.password2.value) return showErr(`The two passwords don't match.`);
    }
    rememberEmail(email);
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Please wait…';
    try {
      if (m === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) {
          if (/email not confirmed/i.test(errMsg(error))) return sentPanel('Confirm your email', `<p>Your account isn't confirmed yet. We've sent a confirmation link to <strong>${esc(email)}</strong>.</p>`, () => sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authBack(next) } }));
          return showErr(friendlyAuthError(error));
        }
        S.session = data.session; await afterLogin(); renderChrome();
        go(takeAfterLogin() || (next === 'join' ? '#/join' : isStaffUser() ? '#/admin' : '#/portal'));
      } else if (m === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: authBack(next) } });
        if (error) return showErr(friendlyAuthError(error));
        if (data.session) { S.session = data.session; await afterLogin(); renderChrome(); return go(next === 'join' ? '#/join' : '#/portal'); }
        sentPanel('Confirm your email', `<p>We've sent a confirmation link to <strong>${esc(email)}</strong>. Click it to finish creating your account.</p>
          <p class="small muted">Already have an account with this email? Go back and log in, or use Forgot password.</p>`,
          () => sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authBack(next) } }));
      } else {
        const send = () => sb.auth.resetPasswordForEmail(email, { redirectTo: authBack() });
        const { error } = await send();
        if (error) return showErr(friendlyAuthError(error));
        sentPanel('Check your inbox', `<p>If <strong>${esc(email)}</strong> has an account, we've sent a link to set a new password.</p>`, send);
      }
    } catch (err) { showErr(friendlyAuthError(err)); }
    finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
  };
  setMode(box.dataset.mode);
}
const takeAfterLogin = () => { try { const h = localStorage.getItem('aimoc_after_login'); localStorage.removeItem('aimoc_after_login'); return /^#\/portal\/position\/[0-9a-f-]{36}$/.test(h || '') ? h : null; } catch { return null; } };
async function signOut() { await sb.auth.signOut(); S.session = null; await afterLogin(); location.hash = '#/'; }

/* ---------------- router ---------------- */
const ROUTES = [];
const route = (re, fn) => ROUTES.push([re, fn]);
const render = html => { $('#app').innerHTML = html; };
const notFound = () => render(`<section class="wrap narrow page"><h1>Page not found</h1><p class="muted">That page doesn't exist or has moved.</p><a class="btn" href="#/">Home</a></section>`);
const loading = () => render('<div class="loading" aria-busy="true">Loading…</div>');

async function router() {
  document.body.classList.remove('nav-open');
  const h = location.hash || '#/';
  const isAdmin = h.startsWith('#/admin');
  document.body.classList.toggle('admin-mode', isAdmin);
  renderChrome();
  for (const [re, fn] of ROUTES) {
    const m = h.match(re);
    if (m) {
      loading();
      try { await fn(...m.slice(1).map(x => (x === undefined ? undefined : decodeURIComponent(x)))); }
      catch (e) { console.error(e); render(`<section class="wrap narrow page"><h1>Something went wrong</h1><p class="notice err">${esc(errMsg(e))}</p></section>`); }
      renderChrome();
      if (!isAdmin || !h.includes('?keep')) window.scrollTo(0, 0);
      return;
    }
  }
  notFound();
}
const go = h => { if (location.hash === h) router(); else location.hash = h; };

/* ---------------- layout ---------------- */
function renderChrome() {
  const s = S.settings;
  const short = s.short_name || 'AIMOC';
  document.title = s.council_name || 'AIMOC';
  $('#brand-short').textContent = short;
  $('#brand-long').textContent = s.council_name || '';
  const h = location.hash || '#/';
  const link = (href, label, cls = '') => {
    const active = h === href || (href !== '#/' && h.startsWith(href + '/'));
    return `<a href="${href}" class="${cls} ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${esc(label)}</a>`;
  };
  let nav = link('#/', 'Home') + S.navPages.map(p => link('#/p/' + p.slug, p.title)).join('')
    + link('#/news', 'Industry News') + link('#/advocacy', 'Advocacy') + link('#/members', 'Members') + link('#/contact', 'Contact');
  let acct = '';
  if (S.session) {
    if (isStaffUser()) acct += link('#/admin', 'Admin', 'nav-pill');
    acct += link('#/portal', 'My account', 'nav-pill');
  } else {
    acct += link('#/login', 'Log in', 'nav-pill') + link('#/join', 'Join AIMOC', 'btn btn-sm');
  }
  $('#nav').innerHTML = nav;
  $('#acct').innerHTML = acct;
  $('#footer').innerHTML = `
    <div class="foot-grid">
      <div><img class="foot-logo" src="assets/aimoc-logo-reversed.svg" alt="AIMOC"><p class="motto">Independent operators. Real impact.</p></div>
      <div class="small">${s.contact_email ? `<a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a><br>` : ''}${s.contact_phone ? esc(s.contact_phone) + '<br>' : ''}${s.postal_address ? esc(s.postal_address) : ''}</div>
      <div class="small"><a href="#/p/membership">Membership</a> · <a href="#/members">Member directory</a> · <a href="#/contact">Contact</a></div>
    </div>
    <p class="small muted">© ${new Date().getFullYear()} ${esc(s.council_name || '')}</p>`;
}

/* ---------------- boot ---------------- */
async function init() {
  if (!CFG.SUPABASE_URL || /YOUR-PROJECT/.test(CFG.SUPABASE_URL)) {
    render(`<section class="wrap narrow page"><h1>Setup needed</h1><p class="notice err">Add your Supabase URL and anon key to <code>js/config.js</code>.</p></section>`);
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  await Promise.all([loadSettings(), loadNav(), afterLogin()]);

  if (BOOT.fromLink || BOOT.next) {
    const nextHash = (BOOT.recovery && '#/set-password') || (BOOT.fromLink && takeAfterLogin()) || { join: '#/join', admin: '#/admin', portal: '#/portal' }[BOOT.next] || (BOOT.fromLink ? (isStaffUser() ? '#/admin' : '#/portal') : null);
    const keepHash = BOOT.notice ? '#/login' : nextHash;
    history.replaceState(null, '', location.pathname + (keepHash || location.hash || '#/'));
  }

  sb.auth.onAuthStateChange((event, sess) => {
    const changed = (sess?.access_token || null) !== (S.session?.access_token || null);
    S.session = sess;
    if (!changed) return;
    // never await supabase calls directly inside this callback
    setTimeout(async () => {
      await afterLogin();
      renderChrome();
      if (event === 'PASSWORD_RECOVERY') return go('#/set-password');
      if (event === 'SIGNED_IN' && /^#\/login/.test(location.hash)) go(takeAfterLogin() || (isStaffUser() ? '#/admin' : '#/portal'));
      if (event === 'SIGNED_OUT') router();
    }, 0);
  });

  window.addEventListener('hashchange', router);
  $('#navToggle').onclick = () => document.body.classList.toggle('nav-open');
  router();
}
