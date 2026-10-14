/* =====================================================================
   AIMOC platform — admin.js
   MFA gate, admin shell, dashboard, organisations, content, enquiries,
   settings & lists, staff, audit log, full data export
   ===================================================================== */

/* ---------------- access gate + MFA ---------------- */
async function requireStaff(roles) {
  if (!S.session) { go('#/login'); return false; }
  if (!S.staff) await afterLogin();
  if (!S.staff?.active) {
    render(`<section class="wrap narrow page"><h1>Council staff only</h1><p class="muted">Your login doesn't have administrator access.</p><a class="btn" href="#/portal">My account</a></section>`);
    return false;
  }
  if (S.staff.mfa_required && S.staff.aal !== 'aal2') { await mfaScreen(); return false; }
  if (roles && !roles.includes(S.staff.role)) {
    adminShell('', `<div class="card"><h1>Not available</h1><p class="muted">Your role (${esc(ROLE_LABELS[S.staff.role])}) doesn't include this area.</p></div>`);
    return false;
  }
  return true;
}

async function mfaScreen() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  const verified = (data?.totp || []).filter(f => f.status === 'verified');
  if (verified.length) {
    render(`<section class="wrap narrow page"><h1>Two-step verification</h1>
      <form id="mfa" class="card form"><p>Enter the 6-digit code from your authenticator app.</p>
        ${field('Code', '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>')}
        <button class="btn" type="submit">Verify</button></form></section>`);
    $('#mfa').onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: verified[0].id, code: e.target.code.value.trim() });
      if (error) return toast('That code didn\'t work — try the newest code.', 'err');
      await afterLogin(); router();
    };
    return;
  }
  // first time: enrol an authenticator
  for (const f of (data?.all || []).filter(f => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
  const en = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'AIMOC admin ' + Date.now() });
  if (en.error) throw en.error;
  render(`<section class="wrap narrow page"><h1>Set up two-step verification</h1>
    <div class="card form">
      <p>Administrator accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</p>
      <ol><li>Scan this QR code with your app.</li><li>Enter the 6-digit code it shows.</li></ol>
      <img class="mfa-qr" src="${esc(en.data.totp.qr_code)}" alt="Authenticator QR code">
      <p class="small">Can't scan? Enter this key manually:<br><span class="secret">${esc(en.data.totp.secret)}</span></p>
      <form id="mfa" class="form">${field('Code', '<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>')}
        <button class="btn" type="submit">Turn on verification</button></form>
    </div></section>`);
  $('#mfa').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: e.target.code.value.trim() });
    if (error) return toast('That code didn\'t work — try again.', 'err');
    toast('Two-step verification is on');
    await afterLogin(); router();
  };
}

/* ---------------- shell ---------------- */
let adminCounts = { at: 0 };
async function refreshCounts(force) {
  if (!force && Date.now() - adminCounts.at < 30000) return;
  const [o, c, e] = await Promise.all([
    sb.from('organisations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
    sb.from('enquiries').select('id', { count: 'exact', head: true }).is('handled_at', null),
  ]);
  adminCounts = { at: Date.now(), orgs: o.count || 0, comms: c.count || 0, enq: e.count || 0 };
}
function adminShell(active, inner) {
  const r = staffRole();
  const item = (key, href, label, count, roles) =>
    (!roles || roles.includes(r)) ? `<a href="${href}" class="${active === key ? 'active' : ''}">${label}${count ? `<span class="count">${count}</span>` : ''}</a>` : '';
  const ADM = ['super_admin', 'council_admin'];
  render(`<div class="admin">
    <nav class="aside" aria-label="Admin">
      ${item('dash', '#/admin', 'Dashboard')}
      ${item('orgs', '#/admin/orgs', 'Organisations', adminCounts.orgs)}
      ${item('comms', '#/admin/comms', 'Communications', adminCounts.comms)}
      ${item('positions', '#/admin/positions', 'Council positions')}
      ${item('reports', '#/admin/reports', 'Reports')}
      ${item('content', '#/admin/content', 'Website content', 0, ADM)}
      ${item('enq', '#/admin/enquiries', 'Enquiries', adminCounts.enq)}
      ${item('settings', '#/admin/settings', 'Settings & lists', 0, ADM)}
      ${item('staff', '#/admin/staff', 'Staff', 0, ['super_admin'])}
      ${item('audit', '#/admin/audit', 'Audit log', 0, ADM)}
      ${item('export', '#/admin/export', 'Export all data', 0, ADM)}
      <div class="who">${esc(S.session.user.email)}<br>${esc(ROLE_LABELS[r])}<br><button class="linklike" id="aOut" type="button">Log out</button></div>
    </nav>
    <div class="admin-main" id="amain">${inner}</div>
  </div>`);
  $('#aOut').onclick = signOut;
}
const amain = html => { $('#amain').innerHTML = html; };
const adminRoute = (re, key, fn, roles) => route(re, async (...a) => {
  if (!(await requireStaff(roles))) return;
  await Promise.all([refreshCounts(), loadLookups()]);
  adminShell(key, '<div class="loading">Loading…</div>');
  await fn(...a);
});

/* ---------------- dashboard ---------------- */
adminRoute(/^#\/admin\/?$/, 'dash', async () => {
  await refreshCounts(true);
  const [orgs, pend, enq, camps, subs] = await Promise.all([
    sb.from('organisations').select('status'),
    sb.from('organisations').select('id,legal_name,trading_name,state,created_at,admin_notes').eq('status', 'pending').order('created_at').limit(10),
    sb.from('enquiries').select('id,name,subject,created_at').is('handled_at', null).order('created_at', { ascending: false }).limit(5),
    sb.from('campaigns').select('id,name,status,scheduled_at,sent_at,recipient_count').in('status', ['pending_approval', 'scheduled', 'sending', 'sent']).order('updated_at', { ascending: false }).limit(6),
    sb.from('stat_submissions').select('org_id,updated_at,verified_at').eq('is_current', true),
  ]);
  const counts = {}; (orgs.data || []).forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
  const withStats = new Set((subs.data || []).map(s => s.org_id)).size;
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString();
  const stale = (subs.data || []).filter(s => s.updated_at < yearAgo).length;
  const unverified = (subs.data || []).filter(s => !s.verified_at).length;
  amain(`<div class="ahead"><div><h1>Dashboard</h1><p class="muted">${esc(S.settings.council_name)}</p></div>
      <div class="row"><a class="btn btn-sm" href="#/admin/comms/new">New communication</a><a class="btn btn-sm ghost" href="#/admin/reports">Reports</a></div></div>
    <div class="kpis">
      <div class="kpi"><strong>${counts.approved || 0}</strong><span>Approved organisations</span></div>
      <div class="kpi ${counts.pending ? 'alert' : ''}"><strong>${counts.pending || 0}</strong><span>Awaiting approval</span></div>
      <div class="kpi"><strong>${withStats}</strong><span>With statistics on file</span></div>
      <div class="kpi"><strong>${unverified}</strong><span>Statistics not yet verified</span></div>
      <div class="kpi ${stale ? 'alert' : ''}"><strong>${stale}</strong><span>Statistics over 12 months old</span></div>
      <div class="kpi ${adminCounts.comms ? 'alert' : ''}"><strong>${adminCounts.comms}</strong><span>Emails awaiting approval</span></div>
    </div>
    <div class="split">
      <div class="card"><h2>Awaiting approval</h2>
        ${(pend.data || []).length ? `<table class="tbl compact"><tbody>${pend.data.map(o => `<tr class="click" data-href="#/admin/org/${o.id}">
          <td><strong>${esc(orgName(o))}</strong>${o.admin_notes?.startsWith('Possible duplicate') ? ' <span class="pill-note">possible duplicate</span>' : ''}<br><span class="small muted">${esc(o.state || '')} · ${fmtDate(o.created_at)}</span></td>
          <td class="num"><a class="btn btn-xs ghost" href="#/admin/org/${o.id}">Review</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing waiting.</p>'}
      </div>
      <div class="card"><h2>Communications</h2>
        ${(camps.data || []).length ? `<table class="tbl compact"><tbody>${camps.data.map(c => `<tr class="click" data-href="#/admin/comms/${c.id}">
          <td>${esc(c.name)}<br><span class="small muted">${c.status === 'scheduled' ? 'Scheduled ' + fmtDateTime(c.scheduled_at) : c.sent_at ? 'Sent ' + fmtDateTime(c.sent_at) + ' · ' + fmtNum(c.recipient_count) + ' recipients' : ''}</span></td>
          <td class="num">${campaignBadge(c.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No recent communications.</p>'}
      </div>
    </div>
    <div class="card"><h2>New enquiries</h2>
      ${(enq.data || []).length ? `<ul class="plain">${enq.data.map(q => `<li><a href="#/admin/enquiries">${esc(q.name)}</a> — ${esc(q.subject || '(no subject)')} <span class="small muted">${fmtDateTime(q.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">No new enquiries.</p>'}
    </div>`);
  wireRowLinks();
});
function wireRowLinks(root = document) {
  $$('tr[data-href]', root).forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a,button,input,select')) location.hash = tr.dataset.href; }));
}

/* =====================================================================
   ORGANISATIONS
   ===================================================================== */
const ORG_SELECT = 'id,legal_name,trading_name,abn_acn,state,operating_states,status,created_at,updated_at,admin_notes,affiliated_with,' +
  'organisation_categories(category_id),organisation_disciplines(discipline_id),' +
  'contacts(full_name,email,phone,is_principal,active),stat_submissions(period_label,is_current,verified_at,updated_at)';

adminRoute(/^#\/admin\/orgs$/, 'orgs', async () => {
  const data = await must(sb.from('organisations').select(ORG_SELECT).order('legal_name'));
  let f = { q: '', status: '', state: '', cat: '', disc: '' };
  try { f = { ...f, ...JSON.parse(sessionStorage.getItem('aimoc_orgf') || '{}') }; } catch {}
  amain(`<div class="ahead"><div><h1>Organisations</h1><p class="muted">${data.length} registered</p></div>
      <div class="row">${canAdmin() ? '<button class="btn btn-sm" id="addOrg" type="button">+ Add organisation</button>' : ''}<button class="btn btn-sm ghost" id="orgCsv" type="button">Export list (CSV)</button></div></div>
    <div class="filters">
      <input type="search" id="fq" placeholder="Search name, ABN, contact…" value="${esc(f.q)}" aria-label="Search">
      <select id="fstatus" aria-label="Status"><option value="">All statuses</option>${['pending', 'approved', 'rejected', 'inactive'].map(s => opt(s, s[0].toUpperCase() + s.slice(1), f.status)).join('')}</select>
      <select id="fstate" aria-label="State"><option value="">All states</option>${STATES.map(s => opt(s, s, f.state)).join('')}</select>
      <select id="fcat" aria-label="Category"><option value="">All categories</option>${S.L.categories.map(c => opt(c.id, c.name, f.cat)).join('')}</select>
      <select id="fdisc" aria-label="Discipline"><option value="">All disciplines</option>${S.L.disciplines.map(c => opt(c.id, c.name, f.disc)).join('')}</select>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Organisation</th><th>State</th><th>Categories</th><th>Lead contact</th><th>Statistics</th><th>Status</th></tr></thead><tbody id="orgRows"></tbody></table></div>`);
  let rows = [];
  const draw = () => {
    sessionStorage.setItem('aimoc_orgf', JSON.stringify(f));
    const q = f.q.toLowerCase();
    rows = data.filter(o => {
      const lead = (o.contacts || []).find(c => c.is_principal && c.active);
      return (!f.status || o.status === f.status) &&
        (!f.state || o.state === f.state || (o.operating_states || []).includes(f.state)) &&
        (!f.cat || o.organisation_categories.some(c => String(c.category_id) === f.cat)) &&
        (!f.disc || o.organisation_disciplines.some(c => String(c.discipline_id) === f.disc)) &&
        (!q || [o.legal_name, o.trading_name, o.abn_acn, lead?.full_name, lead?.email].join(' ').toLowerCase().includes(q));
    });
    $('#orgRows').innerHTML = rows.map(o => {
      const lead = (o.contacts || []).find(c => c.is_principal && c.active);
      const cur = (o.stat_submissions || []).find(s => s.is_current);
      return `<tr class="click" data-href="#/admin/org/${o.id}">
        <td><strong>${esc(orgName(o))}</strong>${o.trading_name ? `<br><span class="small muted">${esc(o.legal_name)}</span>` : ''}${o.admin_notes?.startsWith('Possible duplicate') ? ' <span class="pill-note">possible duplicate</span>' : ''}</td>
        <td>${esc(o.state || '—')}</td>
        <td class="small">${esc(o.organisation_categories.map(c => nameOf(S.L.categories, c.category_id)).join(', '))}</td>
        <td class="small">${lead ? `${esc(lead.full_name)}<br><span class="muted">${esc(lead.email)}</span>` : '<span class="bad">None</span>'}</td>
        <td class="small">${cur ? `${esc(cur.period_label)}<br><span class="muted">${cur.verified_at ? 'Verified' : 'Unverified'} · ${fmtDate(cur.updated_at)}</span>` : '<span class="muted">None</span>'}</td>
        <td>${statusBadge(o.status)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No organisations match.</td></tr>';
    wireRowLinks($('#orgRows'));
  };
  const bind = (id, key) => $('#' + id).addEventListener('input', e => { f[key] = e.target.value; draw(); });
  bind('fq', 'q'); bind('fstatus', 'status'); bind('fstate', 'state'); bind('fcat', 'cat'); bind('fdisc', 'disc');
  draw();
  $('#orgCsv').onclick = () => downloadCsv(rows, [
    { label: 'Registered name', key: 'legal_name' }, { label: 'Trading name', key: 'trading_name' }, { label: 'ABN/ACN', key: 'abn_acn' },
    { label: 'State', key: 'state' }, { label: 'Operating states', get: o => o.operating_states },
    { label: 'Categories', get: o => o.organisation_categories.map(c => nameOf(S.L.categories, c.category_id)) },
    { label: 'Disciplines', get: o => o.organisation_disciplines.map(c => nameOf(S.L.disciplines, c.discipline_id)) },
    { label: 'Lead contact', get: o => o.contacts.find(c => c.is_principal)?.full_name }, { label: 'Lead email', get: o => o.contacts.find(c => c.is_principal)?.email },
    { label: 'Lead phone', get: o => o.contacts.find(c => c.is_principal)?.phone },
    { label: 'Status', key: 'status' }, { label: 'Registered', get: o => fmtDate(o.created_at) },
  ], `aimoc-organisations-${today()}.csv`);
  $('#addOrg')?.addEventListener('click', () => {
    const m = modal(`<h2>Add organisation</h2><p class="small muted">For organisations registered by the Council on their behalf. Permissions are recorded as not granted until confirmed.</p>
      <form class="form" id="ao">${field('Registered name *', '<input name="legal_name" required>')}
      ${field('State *', `<select name="state" required><option value="">Choose…</option>${STATES.map(s => opt(s, STATE_NAMES[s])).join('')}</select>`)}
      <button class="btn" type="submit">Create</button></form>`);
    $('#ao', m.el).onsubmit = async e => {
      e.preventDefault();
      try {
        const o = await must(sb.from('organisations').insert({ legal_name: e.target.legal_name.value.trim(), state: e.target.state.value, status: 'pending' }).select('id').single());
        m.close(); go('#/admin/org/' + o.id);
      } catch (err) { fail(err); }
    };
  });
});

/* ---------------- organisation detail ---------------- */
let orgTab = 'details';
adminRoute(/^#\/admin\/org\/([0-9a-f-]{36})$/, 'orgs', async id => {
  const o = await must(sb.from('organisations').select('*,organisation_categories(category_id),organisation_disciplines(discipline_id)').eq('id', id).maybeSingle());
  if (!o) return amain('<p>Organisation not found.</p>');
  const A = canAdmin();
  amain(`<p class="crumb"><a href="#/admin/orgs">← Organisations</a></p>
    <div class="ahead"><div><h1>${esc(orgName(o))}</h1><p class="muted small">${o.trading_name ? esc(o.legal_name) + ' · ' : ''}Registered ${fmtDate(o.created_at)}${o.approved_at ? ' · approved ' + fmtDate(o.approved_at) : ''}</p></div>
      <div class="row">${statusBadge(o.status)}
        ${A && o.status !== 'approved' ? '<button class="btn btn-sm green" data-status="approved" type="button">Approve</button>' : ''}
        ${A && o.status === 'pending' ? '<button class="btn btn-sm danger" data-status="rejected" type="button">Reject</button>' : ''}
        ${A && o.status === 'approved' ? '<button class="btn btn-sm ghost" data-status="inactive" type="button">Mark inactive</button>' : ''}
        ${A && ['rejected', 'inactive'].includes(o.status) ? '<button class="btn btn-sm ghost" data-status="pending" type="button">Return to pending</button>' : ''}
        <a class="btn btn-sm ghost" href="#/admin/comms/new?org=${o.id}">Email this organisation</a>
      </div></div>
    ${o.status_reason ? `<p class="notice small">Status note: ${esc(o.status_reason)}</p>` : ''}
    ${o.admin_notes?.startsWith('Possible duplicate') ? `<p class="notice small">⚠ ${esc(o.admin_notes.split('\n')[0])}</p>` : ''}
    <div class="tabs" role="tablist">${[['details', 'Details'], ['contacts', 'Contacts'], ['stats', 'Statistics'], ['perms', 'Permissions'], ['affil', 'Affiliations'], ['comms', 'Communications'], ['history', 'History']]
      .map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${orgTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="otab"></div>`);
  $$('[data-tab]').forEach(b => b.onclick = () => { orgTab = b.dataset.tab; $$('[data-tab]').forEach(x => x.classList.toggle('active', x === b)); drawOrgTab(o); });
  $$('[data-status]').forEach(b => b.onclick = () => changeOrgStatus(o, b.dataset.status));
  drawOrgTab(o);
});

async function changeOrgStatus(o, status) {
  let reason = o.status_reason;
  if (status === 'rejected' || status === 'inactive') {
    reason = prompt(status === 'rejected' ? 'Reason for not approving (internal note):' : 'Reason for marking inactive (internal note):', '');
    if (reason === null) return;
  } else if (!confirm(status === 'approved' ? `Approve ${orgName(o)} as a member organisation?` : 'Return to pending?')) return;
  try {
    await must(sb.from('organisations').update({ status, status_reason: reason || null }).eq('id', o.id));
    toast('Status updated');
    adminCounts.at = 0;
    if (status === 'approved' && confirm('Approved. Create a welcome email to the lead contact now?')) {
      const c = await must(sb.from('campaigns').insert({
        name: `Welcome — ${orgName(o)}`, subject: `Welcome to ${S.settings.short_name || 'AIMOC'}`,
        body_html: `<p>Hi {{first_name}},</p><p>Thank you for registering <strong>{{org_name}}</strong>. Your organisation has been approved as a participant in the ${esc(S.settings.council_name)}.</p><p>You can log in at any time to view your organisation's details and manage your data-sharing permissions.</p><p>Kind regards,<br>${esc(S.settings.council_name)}</p>`,
        audience: { org_ids: [o.id], principal_only: true, include_pending: true },
      }).select('id').single());
      return go('#/admin/comms/' + c.id);
    }
    router();
  } catch (e) { fail(e); }
}

async function drawOrgTab(o) {
  const el = $('#otab'); el.innerHTML = '<div class="loading">Loading…</div>';
  try { await ({ details: tabDetails, contacts: tabContacts, stats: tabStats, perms: tabPerms, affil: tabAffil, comms: tabOrgComms, history: tabHistory }[orgTab])(o, el); }
  catch (e) { el.innerHTML = `<p class="notice err">${esc(errMsg(e))}</p>`; }
}

/* ---- details ---- */
async function tabDetails(o, el) {
  const A = canAdmin();
  const cats = o.organisation_categories.map(c => String(c.category_id)), discs = o.organisation_disciplines.map(c => String(c.discipline_id));
  el.innerHTML = `<form id="od" class="card form">
    <fieldset ${A ? '' : 'disabled'} style="border:0;padding:0" class="form">
    <h2>A. Organisation details</h2>
    <div class="grid2">
      ${field('Registered name *', `<input name="legal_name" required value="${esc(o.legal_name)}">`)}
      ${field('Trading name', `<input name="trading_name" value="${esc(o.trading_name)}">`)}
      ${field('ABN / ACN', `<input name="abn_acn" value="${esc(o.abn_acn)}">`)}
      ${field('Website', `<input name="website" value="${esc(o.website)}">`)}
      ${field('State (head office)', `<select name="state"><option value="">—</option>${STATES.map(s => opt(s, s, o.state)).join('')}</select>`)}
      ${field('Year established', `<input name="year_established" type="number" value="${esc(o.year_established)}">`)}
    </div>
    ${field('Postal address', `<textarea name="postal_address" rows="2">${esc(o.postal_address)}</textarea>`)}
    <fieldset><legend>Operating states</legend><div class="check-grid">${[...STATES, 'National'].map(s => chk('operating_states', s, (o.operating_states || []).includes(s), s)).join('')}</div></fieldset>
    ${field('Operating regions', `<input name="operating_regions" value="${esc(o.operating_regions)}">`)}
    ${field('Description', `<textarea name="description" rows="3">${esc(o.description)}</textarea>`)}
    <div class="field"><span class="lbl">Logo</span><div class="logo-up">${o.logo_path ? `<img src="${esc(logoUrl(o.logo_path))}" alt="">` : '<div class="logo-ph">—</div>'}<input type="file" id="ologo" accept="image/*"></div></div>
    <fieldset><legend>Categories</legend><div class="check-grid">${S.L.categories.map(c => chk('cats', c.id, cats.includes(String(c.id)), esc(c.name) + (c.active ? '' : ' (retired)'))).join('')}</div></fieldset>
    ${field('Other category', `<input name="category_other" value="${esc(o.category_other)}">`)}
    <fieldset><legend>B. Disciplines</legend><div class="check-grid">${S.L.disciplines.map(c => chk('discs', c.id, discs.includes(String(c.id)), esc(c.name) + (c.active ? '' : ' (retired)'))).join('')}</div></fieldset>
    ${field('Other discipline', `<input name="discipline_other" value="${esc(o.discipline_other)}">`)}
    ${field('Stated affiliation (from registration)', `<input name="affiliated_with" value="${esc(o.affiliated_with)}">`, 'Link actual affiliations on the Affiliations tab so reports can avoid double counting.')}
    ${field('Internal admin notes', `<textarea name="admin_notes" rows="3">${esc(o.admin_notes)}</textarea>`, 'Never shown to the organisation.')}
    ${A ? '<div class="row"><button class="btn" type="submit">Save details</button>' + (isSuper() ? '<button class="btn danger" type="button" id="delOrg">Delete organisation</button>' : '') + '</div>' : ''}
    </fieldset></form>`;
  if (!A) return;
  $('#ologo').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const p = await uploadFile('org-logos', file, 'admin'); await must(sb.from('organisations').update({ logo_path: p }).eq('id', o.id)); o.logo_path = p; toast('Logo updated'); tabDetails(o, el); } catch (err) { fail(err); }
  };
  $('#od').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim() || null;
    const patch = { legal_name: v('legal_name'), trading_name: v('trading_name'), abn_acn: v('abn_acn'), website: v('website'), state: v('state'), year_established: v('year_established'), postal_address: v('postal_address'), operating_regions: v('operating_regions'), description: v('description'), category_other: v('category_other'), discipline_other: v('discipline_other'), affiliated_with: v('affiliated_with'), admin_notes: v('admin_notes'), operating_states: checkedValues(f, 'operating_states') };
    try {
      await must(sb.from('organisations').update(patch).eq('id', o.id));
      await syncLinks('organisation_categories', 'category_id', o.id, cats, checkedValues(f, 'cats'));
      await syncLinks('organisation_disciplines', 'discipline_id', o.id, discs, checkedValues(f, 'discs'));
      toast('Saved'); router();
    } catch (err) { fail(err); }
  };
  $('#delOrg')?.addEventListener('click', async () => {
    if (prompt(`This permanently deletes ${o.legal_name}, its contacts, statistics and permission records.\nType DELETE to confirm.`) !== 'DELETE') return;
    try { await must(sb.from('organisations').delete().eq('id', o.id)); toast('Deleted'); go('#/admin/orgs'); } catch (err) { fail(err); }
  });
}
async function syncLinks(table, col, orgId, before, after) {
  const add = after.filter(x => !before.includes(x)), del = before.filter(x => !after.includes(x));
  if (del.length) await must(sb.from(table).delete().eq('org_id', orgId).in(col, del.map(Number)));
  if (add.length) await must(sb.from(table).insert(add.map(x => ({ org_id: orgId, [col]: Number(x) }))));
}

/* ---- contacts ---- */
async function tabContacts(o, el) {
  const list = await must(sb.from('contacts').select('*,contact_role_links(role_id),contact_disciplines(discipline_id)').eq('org_id', o.id).order('is_principal', { ascending: false }).order('full_name'));
  const A = canAdmin();
  el.innerHTML = `<div class="row between"><p class="muted small">${list.filter(c => c.active).length} active contact(s). Each has their own email preferences.</p>
      ${A ? '<button class="btn btn-sm" id="addC" type="button">+ Add contact</button>' : ''}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email / phone</th><th>Roles</th><th>Portal</th><th>Email status</th><th></th></tr></thead><tbody>
    ${list.map(c => `<tr class="${c.active ? '' : 'muted'}">
      <td><strong>${esc(c.full_name)}</strong>${c.is_principal ? ' <span class="tag">Lead</span>' : ''}${c.active ? '' : ' <span class="tag soft">inactive</span>'}<br><span class="small muted">${esc(c.position_title || '')}</span>
        ${c.authorised_to_speak ? '<br><span class="small">✓ may speak</span>' : ''}${c.authorised_to_vote ? ' <span class="small">✓ may vote</span>' : ''}</td>
      <td class="small"><a href="mailto:${esc(c.email)}">${esc(c.email)}</a><br>${esc(c.phone || '')} <span class="muted">(${esc(c.preferred_contact)})</span></td>
      <td class="small">${esc([...c.contact_role_links.map(r => nameOf(S.L.roles, r.role_id)), c.role_other].filter(Boolean).join(', ') || '—')}</td>
      <td class="small">${esc(ROLE_LABELS[c.portal_access])}<br><span class="muted">${c.user_id ? 'Has logged in' : 'Not yet logged in'}</span></td>
      <td>${c.bounced_at ? '<span class="badge st-bounced">Bounced</span>' : c.unsubscribed_at || !c.receive_council_comms ? '<span class="badge st-inactive">Unsubscribed</span>' : '<span class="badge st-active">Subscribed</span>'}</td>
      <td class="num"><button class="btn btn-xs ghost" data-edit="${c.id}" type="button">${A ? 'Edit' : 'View'}</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#addC')?.addEventListener('click', () => contactModal(o, null, () => tabContacts(o, el)));
  $$('[data-edit]', el).forEach(b => b.onclick = () => contactModal(o, list.find(c => c.id === b.dataset.edit), () => tabContacts(o, el)));
}

async function contactModal(o, c, done) {
  const A = canAdmin();
  const isNew = !c;
  c = c || { preferred_contact: 'email', portal_access: 'org_rep', receive_council_comms: true, active: true, contact_role_links: [], contact_disciplines: [] };
  const roles = c.contact_role_links.map(r => String(r.role_id)), discs = c.contact_disciplines.map(d => String(d.discipline_id));
  const hist = isNew ? [] : (await sb.from('campaign_recipients').select('status,sent_at,campaigns(name,subject)').eq('contact_id', c.id).order('sent_at', { ascending: false }).limit(20)).data || [];
  const m = modal(`<h2>${isNew ? 'Add contact' : esc(c.full_name)}</h2>
    <form class="form" id="cf"><fieldset ${A ? '' : 'disabled'} style="border:0;padding:0" class="form">
      <div class="grid2">
        ${field('Full name *', `<input name="full_name" required value="${esc(c.full_name)}">`)}
        ${field('Email *', `<input name="email" type="email" required value="${esc(c.email)}">`)}
        ${field('Position / title', `<input name="position_title" value="${esc(c.position_title)}">`)}
        ${field('Phone', `<input name="phone" value="${esc(c.phone)}">`)}
        ${field('Preferred contact', `<select name="preferred_contact">${['email', 'phone', 'sms'].map(x => opt(x, x, c.preferred_contact)).join('')}</select>`)}
        ${field('Portal access', `<select name="portal_access">${['org_admin', 'org_rep', 'none'].map(x => opt(x, ROLE_LABELS[x], c.portal_access)).join('')}</select>`)}
      </div>
      <fieldset><legend>Roles</legend><div class="check-grid">${S.L.roles.map(r => chk('roles', r.id, roles.includes(String(r.id)), esc(r.name))).join('')}</div></fieldset>
      ${field('Other role', `<input name="role_other" value="${esc(c.role_other)}">`)}
      <details><summary>Discipline subscriptions (none ticked = all)</summary><div class="check-grid">${S.L.disciplines.map(d => chk('discs', d.id, discs.includes(String(d.id)), esc(d.name))).join('')}</div></details>
      <div class="stack">
        ${chk('is_principal', '1', c.is_principal, '<strong>Lead (principal) contact</strong> — replaces the current lead')}
        ${chk('authorised_to_speak', '1', c.authorised_to_speak, 'Authorised to speak on behalf of the organisation')}
        ${chk('authorised_to_vote', '1', c.authorised_to_vote, 'Authorised to vote on behalf of the organisation')}
        ${chk('receive_council_comms', '1', c.receive_council_comms && !c.unsubscribed_at, 'Receives Council communications')}
        ${c.bounced_at ? chk('clear_bounce', '1', false, `Clear bounce flag (bounced ${fmtDate(c.bounced_at)})`) : ''}
        ${chk('active', '1', c.active, 'Active')}
      </div>
      ${c.unsubscribed_at ? `<p class="small muted">Unsubscribed ${fmtDateTime(c.unsubscribed_at)}. Only re-subscribe with the person's agreement.</p>` : ''}
      ${A ? `<div class="row"><button class="btn" type="submit">Save</button>${!isNew && !c.is_principal ? '<button class="btn danger" type="button" id="cdel">Delete</button>' : ''}</div>` : ''}
    </fieldset></form>
    ${hist.length ? `<h3>Communication history</h3><table class="tbl compact">${hist.map(h => `<tr><td>${esc(h.campaigns?.subject || h.campaigns?.name || '')}</td><td>${campaignBadge(h.status)}</td><td class="small muted">${fmtDate(h.sent_at)}</td></tr>`).join('')}</table>` : ''}`, { wide: true });
  if (!A) return;
  $('#cf', m.el).onsubmit = async e => {
    e.preventDefault();
    const f = e.target, v = n => f.elements[n].value.trim() || null, on = n => !!f.elements[n]?.checked;
    const row = { full_name: v('full_name'), email: (v('email') || '').toLowerCase(), position_title: v('position_title'), phone: v('phone'), preferred_contact: v('preferred_contact'), portal_access: v('portal_access'), role_other: v('role_other'), authorised_to_speak: on('authorised_to_speak'), authorised_to_vote: on('authorised_to_vote'), receive_council_comms: on('receive_council_comms'), active: on('active') };
    if (row.receive_council_comms) row.unsubscribed_at = null;
    if (on('clear_bounce')) row.bounced_at = null;
    const makeLead = on('is_principal');
    try {
      if (makeLead && !c.is_principal) await must(sb.from('contacts').update({ is_principal: false }).eq('org_id', o.id).eq('is_principal', true));
      row.is_principal = makeLead;
      let id = c.id;
      if (isNew) id = (await must(sb.from('contacts').insert({ ...row, org_id: o.id }).select('id').single())).id;
      else await must(sb.from('contacts').update(row).eq('id', c.id));
      const sync = async (table, col, before, after) => {
        const add = after.filter(x => !before.includes(x)), del = before.filter(x => !after.includes(x));
        if (del.length) await must(sb.from(table).delete().eq('contact_id', id).in(col, del.map(Number)));
        if (add.length) await must(sb.from(table).insert(add.map(x => ({ contact_id: id, [col]: Number(x) }))));
      };
      await sync('contact_role_links', 'role_id', roles, checkedValues(f, 'roles'));
      await sync('contact_disciplines', 'discipline_id', discs, checkedValues(f, 'discs'));
      toast('Contact saved'); m.close(); done();
    } catch (err) { fail(/contacts_org_email/.test(errMsg(err)) ? 'That email is already a contact for this organisation.' : err); }
  };
  $('#cdel', m.el)?.addEventListener('click', async () => {
    if (!confirm(`Delete ${c.full_name}? Consider marking inactive instead to keep their history.`)) return;
    try { await must(sb.from('contacts').delete().eq('id', c.id)); toast('Deleted'); m.close(); done(); } catch (err) { fail(err); }
  });
}

/* ---- statistics ---- */
async function tabStats(o, el) {
  const subs = await must(sb.from('stat_submissions').select('*,stat_values(*)').eq('org_id', o.id).order('created_at', { ascending: false }));
  const cur = subs.find(s => s.is_current);
  const A = canAdmin();
  const valTable = (s, editable) => `<div class="table-wrap"><table class="tbl"><thead><tr><th>Measure</th><th>Answer</th><th class="num">Figure</th><th>Accuracy</th><th>Notes</th></tr></thead><tbody>
    ${S.L.metrics.map(m => {
      const v = (s.stat_values || []).find(x => x.metric_key === m.key) || {};
      if (!editable) return `<tr><td>${esc(m.label)} <span class="kind kind-${m.kind}">${m.kind}</span></td><td>${v.answer ? esc(ANSWERS[v.answer]) : '<span class="muted">No response</span>'}</td><td class="num">${v.answer === 'reported' ? fmtNum(v.value) : ''}</td><td>${esc(v.precision || '')}</td><td class="small">${esc(v.notes || '')}</td></tr>`;
      return `<tr data-key="${m.key}"><td>${esc(m.label)}</td>
        <td><select name="ans"><option value="">No response</option>${Object.entries(ANSWERS).map(([k, l]) => opt(k, l, v.answer)).join('')}</select></td>
        <td><input name="val" type="number" min="0" value="${esc(v.value ?? '')}" style="max-width:120px"></td>
        <td><select name="pre">${opt('estimate', 'Estimate', v.precision || 'estimate')}${opt('exact', 'Exact', v.precision)}</select></td>
        <td><input name="note" value="${esc(v.notes || '')}"></td></tr>`;
    }).join('')}</tbody></table></div>`;
  el.innerHTML = `
    ${o.stats_review_requested_at ? `<p class="notice small">Update requested ${fmtDate(o.stats_review_requested_at)}.</p>` : ''}
    <div class="card">
      <div class="row between"><h2>Current statistics</h2>
        <div class="row">${A ? `${cur ? `<button class="btn btn-sm ghost" id="sEdit" type="button">Edit figures</button>${cur.verified_at ? '' : '<button class="btn btn-sm green" id="sVerify" type="button">Mark verified</button>'}` : ''}
          <button class="btn btn-sm ghost" id="sNew" type="button">New reporting period</button>
          <button class="btn btn-sm ghost" id="sReq" type="button">Request update</button>` : ''}</div></div>
      ${cur ? `<dl class="dl"><dt>Reporting period</dt><dd>${esc(cur.period_label)}${cur.period_start ? ` (${fmtDate(cur.period_start)} – ${fmtDate(cur.period_end)})` : ''}</dd>
        <dt>Includes affiliates</dt><dd>${cur.includes_affiliates ? 'Yes — people figures include affiliated clubs' : 'No'}</dd>
        <dt>Source</dt><dd>${esc(cur.source_note || '—')}</dd>
        <dt>Submitted</dt><dd>${esc(cur.submitted_by_name || '')} · ${fmtDateTime(cur.created_at)}</dd>
        <dt>Last updated</dt><dd>${fmtDateTime(cur.updated_at)}</dd>
        <dt>Verified</dt><dd>${cur.verified_at ? '✓ ' + fmtDateTime(cur.verified_at) : '<span class="bad">Not verified</span>'}</dd></dl>
        <div id="sVals">${valTable(cur, false)}</div>` : '<p class="muted">No statistics on file.</p>'}
    </div>
    ${subs.filter(s => !s.is_current).length ? `<div class="card"><h2>Previous periods</h2>${subs.filter(s => !s.is_current).map(s => `<details><summary>${esc(s.period_label)} — ${fmtDate(s.updated_at)}</summary>${valTable(s, false)}</details>`).join('')}</div>` : ''}`;
  if (!A) return;
  $('#sVerify')?.addEventListener('click', async () => { try { await must(sb.from('stat_submissions').update({ verified_at: new Date().toISOString() }).eq('id', cur.id)); toast('Marked verified'); tabStats(o, el); } catch (e) { fail(e); } });
  $('#sNew').onclick = async () => {
    const label = prompt('Reporting period for the new figures (e.g. "2026 calendar year"):', ''); if (!label) return;
    try { await must(sb.from('stat_submissions').insert({ org_id: o.id, period_label: label.trim(), submitted_by_name: 'Entered by Council (' + S.session.user.email + ')' })); toast('New period created — enter the figures'); await tabStats(o, el); $('#sEdit')?.click(); } catch (e) { fail(e); }
  };
  $('#sReq').onclick = async () => {
    try {
      await must(sb.from('organisations').update({ stats_review_requested_at: new Date().toISOString() }).eq('id', o.id));
      const c = await must(sb.from('campaigns').insert({
        name: `Statistics update — ${orgName(o)}`, subject: 'Please review your organisation\'s statistics',
        body_html: `<p>Hi {{first_name}},</p><p>The Council is preparing updated industry figures. Could you please review and confirm the participation statistics for <strong>{{org_name}}</strong>?</p><p>Reply to this email with any changes, or let us know the figures are still current.</p><p>Thank you,<br>${esc(S.settings.council_name)}</p>`,
        audience: { org_ids: [o.id], principal_only: true, include_pending: true },
      }).select('id').single());
      go('#/admin/comms/' + c.id);
    } catch (e) { fail(e); }
  };
  $('#sEdit')?.addEventListener('click', () => {
    $('#sVals').innerHTML = `<form id="sForm" class="form">
      <div class="grid3">${field('Reporting period', `<input name="period_label" required value="${esc(cur.period_label)}">`)}${field('Start', `<input name="period_start" type="date" value="${esc(cur.period_start || '')}">`)}${field('End', `<input name="period_end" type="date" value="${esc(cur.period_end || '')}">`)}</div>
      ${chk('includes_affiliates', '1', cur.includes_affiliates, 'People figures include affiliated clubs')}
      ${field('Source note', `<input name="source_note" value="${esc(cur.source_note || '')}">`)}
      ${valTable(cur, true)}
      <div class="row"><button class="btn" type="submit">Save figures</button><button class="btn ghost" type="button" id="sCancel">Cancel</button></div></form>`;
    $('#sCancel').onclick = () => tabStats(o, el);
    $('#sForm').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      const upserts = [], dels = [];
      for (const tr of $$('tr[data-key]', f)) {
        const k = tr.dataset.key, ans = $('[name=ans]', tr).value, val = $('[name=val]', tr).value;
        if (!ans) { dels.push(k); continue; }
        if (ans === 'reported' && val === '') return toast(`Enter a figure for ${nameOf(S.L.metrics.map(m => ({ id: m.key, name: m.label })), k)}`, 'err');
        upserts.push({ submission_id: cur.id, metric_key: k, answer: ans, value: ans === 'reported' ? Number(val) : null, precision: ans === 'reported' ? $('[name=pre]', tr).value : null, notes: $('[name=note]', tr).value.trim() || null });
      }
      try {
        await must(sb.from('stat_submissions').update({ period_label: f.period_label.value.trim(), period_start: f.period_start.value || null, period_end: f.period_end.value || null, includes_affiliates: f.includes_affiliates.checked, source_note: f.source_note.value.trim() || null }).eq('id', cur.id));
        if (upserts.length) await must(sb.from('stat_values').upsert(upserts));
        if (dels.length) await must(sb.from('stat_values').delete().eq('submission_id', cur.id).in('metric_key', dels));
        toast('Figures saved'); tabStats(o, el);
      } catch (err) { fail(err); }
    };
  });
}

/* ---- permissions ---- */
async function tabPerms(o, el) {
  const hist = await must(sb.from('organisation_consents').select('*').eq('org_id', o.id).order('recorded_at', { ascending: false }));
  const cur = {}; hist.forEach(h => { if (!cur[h.consent_key]) cur[h.consent_key] = h; });
  const A = canAdmin();
  el.innerHTML = `<div class="card"><h2>Current permissions</h2>
      <p class="small muted">Changes made here are recorded as "on behalf of" the organisation, with your login, the date and wording v${esc(S.settings.consent_version)}. Only change these on the organisation's instruction.</p>
      <div class="consents">${currentStatements().map(c => {
        const h = cur[c.key];
        return `<label class="consent"><input type="checkbox" data-k="${esc(c.key)}" ${h?.granted ? 'checked' : ''} ${A ? '' : 'disabled'}>
          <span><strong>${esc(c.label)}</strong> ${h ? `<span class="small muted">— ${h.granted ? 'granted' : 'not granted'} ${fmtDate(h.recorded_at)} (v${esc(h.statement_version)}, ${esc(h.method.replace(/_/g, ' '))})</span>` : '<span class="small bad">— never recorded</span>'}<br>
          <span class="small">${esc(c.statement)}</span></span></label>`;
      }).join('')}</div></div>
    <div class="card"><h2>Full history</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>When</th><th>Permission</th><th>Decision</th><th>Version</th><th>Method</th><th>Recorded by</th></tr></thead><tbody>
      ${hist.map(h => `<tr><td class="small">${fmtDateTime(h.recorded_at)}</td><td>${esc(S.L.consentTypes.find(t => t.key === h.consent_key)?.label || h.consent_key)}</td>
        <td>${h.granted ? '<span class="badge st-approved">Granted</span>' : '<span class="badge st-inactive">Not granted</span>'}</td><td>v${esc(h.statement_version)}</td>
        <td class="small">${esc(h.method.replace(/_/g, ' '))}</td><td class="small">${esc(h.recorded_by_name || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No records.</td></tr>'}
    </tbody></table></div></div>`;
  $$('[data-k]', el).forEach(cb => cb.onchange = async () => {
    if (!confirm(`Record that ${orgName(o)} has ${cb.checked ? 'GRANTED' : 'WITHDRAWN'} this permission?`)) { cb.checked = !cb.checked; return; }
    const { error } = await sb.rpc('record_consent', { p_org: o.id, p_key: cb.dataset.k, p_granted: cb.checked });
    if (error) { cb.checked = !cb.checked; return fail(error); }
    toast('Recorded'); tabPerms(o, el);
  });
}

/* ---- affiliations ---- */
async function tabAffil(o, el) {
  const [rows, all] = await Promise.all([
    must(sb.from('organisation_affiliations').select('*').or(`child_org_id.eq.${o.id},parent_org_id.eq.${o.id}`)),
    must(sb.from('organisations').select('id,legal_name,trading_name,state').neq('id', o.id).order('legal_name')),
  ]);
  const nm = id => orgName(all.find(x => x.id === id)) || '(unknown)';
  const A = canAdmin();
  el.innerHTML = `<div class="card">
    <h2>Affiliations</h2>
    <p class="small muted">Record which organisations sit under which, and whether a parent's figures already include this organisation's people. Reports use this to flag and adjust double counting.</p>
    ${o.affiliated_with ? `<p class="notice small">Stated at registration: <strong>${esc(o.affiliated_with)}</strong></p>` : ''}
    <table class="tbl"><thead><tr><th>Relationship</th><th>Organisation</th><th>People already counted in parent?</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.child_org_id === o.id ? 'Affiliated with (parent)' : 'Has affiliate (child)'}</td>
      <td><a href="#/admin/org/${r.child_org_id === o.id ? r.parent_org_id : r.child_org_id}">${esc(nm(r.child_org_id === o.id ? r.parent_org_id : r.child_org_id))}</a></td>
      <td>${r.figures_included_in_parent ? 'Yes' : 'No'}</td>
      <td class="num">${A ? `<button class="btn btn-xs danger" type="button" data-del="${r.child_org_id}|${r.parent_org_id}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None recorded.</td></tr>'}
    </tbody></table>
    ${A ? `<form id="afForm" class="form" style="margin-top:16px">
      <div class="grid3">
        ${field('This organisation is…', `<select name="dir">${opt('child', 'affiliated with / sanctioned by')}${opt('parent', 'the parent body of')}</select>`)}
        ${field('Organisation', `<select name="other" required><option value="">Choose…</option>${all.map(x => opt(x.id, orgName(x) + (x.state ? ` (${x.state})` : ''))).join('')}</select>`)}
        ${field('&nbsp;', chk('included', '1', true, "Parent's people figures already include the child's"))}
      </div><button class="btn btn-sm" type="submit">Add affiliation</button></form>` : ''}</div>`;
  if (!A) return;
  $('#afForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, other = f.other.value;
    const row = f.dir.value === 'child' ? { child_org_id: o.id, parent_org_id: other } : { child_org_id: other, parent_org_id: o.id };
    try { await must(sb.from('organisation_affiliations').insert({ ...row, figures_included_in_parent: f.included.checked })); toast('Added'); tabAffil(o, el); } catch (err) { fail(err); }
  };
  $$('[data-del]', el).forEach(b => b.onclick = async () => {
    const [c, p] = b.dataset.del.split('|');
    try { await must(sb.from('organisation_affiliations').delete().eq('child_org_id', c).eq('parent_org_id', p)); tabAffil(o, el); } catch (err) { fail(err); }
  });
}

/* ---- comms history ---- */
async function tabOrgComms(o, el) {
  const rows = await must(sb.from('campaign_recipients').select('email,full_name,status,sent_at,last_event_at,campaign_id,campaigns(name,subject)').eq('org_id', o.id).order('sent_at', { ascending: false }).limit(500));
  el.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Sent</th><th>Communication</th><th>Recipient</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-href="#/admin/comms/${r.campaign_id}"><td class="small">${fmtDateTime(r.sent_at)}</td><td>${esc(r.campaigns?.subject || r.campaigns?.name || '')}</td>
      <td class="small">${esc(r.full_name || '')}<br><span class="muted">${esc(r.email)}</span></td><td>${campaignBadge(r.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No communications sent to this organisation yet.</td></tr>'}
  </tbody></table></div>`;
  wireRowLinks(el);
}

/* ---- history (audit) ---- */
async function tabHistory(o, el) {
  if (!canAdmin()) { el.innerHTML = '<p class="muted">Audit history is available to Council Administrators.</p>'; return; }
  const rows = await must(sb.from('audit_log').select('*').or(`entity_id.eq.${o.id},changes->>org_id.eq.${o.id}`).order('at', { ascending: false }).limit(200));
  el.innerHTML = auditTable(rows);
}

/* =====================================================================
   AUDIT LOG
   ===================================================================== */
function auditTable(rows) {
  const show = v => {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return esc(s.length > 140 ? s.slice(0, 140) + '…' : s);
  };
  const changes = r => {
    if (!r.changes) return '';
    if (r.action === 'update') return Object.entries(r.changes).map(([k, [a, b]]) => `<div><strong>${esc(k)}</strong>: ${show(a)} → ${show(b)}</div>`).join('');
    return `<details><summary class="small">${r.action === 'insert' ? 'Created record' : r.action === 'delete' ? 'Deleted record' : esc(r.action)}</summary><pre class="small" style="white-space:pre-wrap">${esc(JSON.stringify(r.changes, null, 1))}</pre></details>`;
  };
  return `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Changes</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="small nowrap">${fmtDateTime(r.at)}</td><td class="small">${esc(r.actor_email || (r.actor ? r.actor.slice(0, 8) : 'system'))}</td>
      <td><span class="badge">${esc(r.action)}</span></td><td class="small">${esc(r.entity)}</td><td class="small">${changes(r)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No entries.</td></tr>'}
  </tbody></table></div>`;
}

adminRoute(/^#\/admin\/audit$/, 'audit', async () => {
  let page = 0; const size = 100; let f = { entity: '', who: '' };
  amain(`<div class="ahead"><div><h1>Audit log</h1><p class="muted">Every change to organisations, contacts, statistics, permissions, communications, content and settings.</p></div></div>
    <div class="filters"><select id="ae"><option value="">All records</option>${['organisations', 'contacts', 'stat_submissions', 'stat_values', 'organisation_consents', 'campaigns', 'staff', 'site_settings', 'pages', 'posts'].map(x => opt(x, x)).join('')}</select>
      <input type="search" id="aw" placeholder="Filter by email…"><button class="btn btn-sm ghost" id="aMore" type="button">Older →</button></div>
    <div id="aRows"></div>`);
  const load = async () => {
    let q = sb.from('audit_log').select('*').order('at', { ascending: false }).range(page * size, page * size + size - 1);
    if (f.entity) q = q.eq('entity', f.entity);
    if (f.who) q = q.ilike('actor_email', `%${f.who}%`);
    $('#aRows').innerHTML = auditTable(await must(q));
  };
  $('#ae').onchange = e => { f.entity = e.target.value; page = 0; load(); };
  $('#aw').oninput = debounce(e => { f.who = e.target.value; page = 0; load(); });
  $('#aMore').onclick = () => { page++; load(); };
  load();
}, ['super_admin', 'council_admin']);

/* =====================================================================
   WEBSITE CONTENT
   ===================================================================== */
adminRoute(/^#\/admin\/content$/, 'content', async () => {
  const [pages, posts] = await Promise.all([
    must(sb.from('pages').select('id,slug,title,published,show_in_nav,nav_order,updated_at').order('nav_order')),
    must(sb.from('posts').select('id,kind,slug,title,topic,members_only,published,published_at').order('published_at', { ascending: false })),
  ]);
  const postRows = kind => posts.filter(p => p.kind === kind).map(p => `<tr class="click" data-href="#/admin/content/post/${p.id}"><td><strong>${esc(p.title)}</strong>${p.topic ? ` <span class="tag">${esc(p.topic)}</span>` : ''}</td>
    <td class="small">${fmtDate(p.published_at)}</td><td>${p.members_only ? '<span class="tag lock">Members</span>' : 'Public'}</td><td>${p.published ? '<span class="badge st-approved">Published</span>' : '<span class="badge st-draft">Draft</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet.</td></tr>';
  amain(`<div class="ahead"><div><h1>Website content</h1><p class="muted">Pages, news and advocacy submissions. Written in Markdown — no developer needed.</p></div>
      <div class="row"><a class="btn btn-sm" href="#/admin/content/post/new?kind=news">+ News item</a><a class="btn btn-sm" href="#/admin/content/post/new?kind=submission">+ Submission</a><a class="btn btn-sm ghost" href="#/admin/content/page/new">+ Page</a></div></div>
    <div class="card"><h2>Pages</h2><table class="tbl"><thead><tr><th>Title</th><th>Address</th><th>Menu</th><th>Status</th></tr></thead><tbody>
      ${pages.map(p => `<tr class="click" data-href="#/admin/content/page/${p.id}"><td><strong>${esc(p.title)}</strong></td><td class="small">#/p/${esc(p.slug)}</td><td>${p.show_in_nav ? p.nav_order : '—'}</td><td>${p.published ? '<span class="badge st-approved">Published</span>' : '<span class="badge st-draft">Draft</span>'}</td></tr>`).join('')}
    </tbody></table><p class="small muted">The home page, News, Advocacy, Members and Contact pages are built in. Home page priorities are edited under Settings.</p></div>
    <div class="card"><h2>Industry news</h2><table class="tbl"><tbody>${postRows('news')}</tbody></table></div>
    <div class="card"><h2>Advocacy &amp; submissions</h2><table class="tbl"><tbody>${postRows('submission')}</tbody></table></div>`);
  wireRowLinks();
}, ['super_admin', 'council_admin']);

function mdField(name, label, value, rows = 16) {
  return `<div class="field md-field"><div class="row between"><span class="lbl">${label}</span>
      <div class="row"><button class="chip active" type="button" data-md="w">Write</button><button class="chip" type="button" data-md="p">Preview</button></div></div>
    <textarea name="${name}" rows="${rows}" placeholder="## Heading, **bold**, - list item, [link text](https://…)">${esc(value)}</textarea>
    <div class="prose card sub md-prev" hidden></div></div>`;
}
function wireMd(root) {
  $$('.md-field', root).forEach(w => {
    const ta = $('textarea', w), pv = $('.md-prev', w);
    $$('[data-md]', w).forEach(b => b.onclick = () => {
      const prev = b.dataset.md === 'p';
      $$('[data-md]', w).forEach(x => x.classList.toggle('active', x === b));
      ta.hidden = prev; pv.hidden = !prev; if (prev) pv.innerHTML = md(ta.value) || '<p class="muted">Nothing yet.</p>';
    });
  });
}

adminRoute(/^#\/admin\/content\/page\/(new|[0-9a-f-]{36})$/, 'content', async id => {
  const isNew = id === 'new';
  const p = isNew ? { nav_order: 50, show_in_nav: true, published: false } : await must(sb.from('pages').select('*').eq('id', id).single());
  amain(`<p class="crumb"><a href="#/admin/content">← Website content</a></p><h1>${isNew ? 'New page' : esc(p.title)}</h1>
    <form id="pf" class="card form">
      <div class="grid2">${field('Title *', `<input name="title" required value="${esc(p.title)}">`)}${field('Address (slug)', `<input name="slug" value="${esc(p.slug)}" placeholder="auto from title">`, 'Page appears at #/p/<slug>')}</div>
      ${field('Summary (shown under the title)', `<input name="summary" value="${esc(p.summary)}">`)}
      ${mdField('body', 'Content', p.body)}
      <div class="row">${field('Menu order', `<input name="nav_order" type="number" value="${esc(p.nav_order)}" style="width:100px">`)}${chk('show_in_nav', '1', p.show_in_nav, 'Show in main menu')}${chk('published', '1', p.published, 'Published')}</div>
      <div class="row"><button class="btn" type="submit">Save page</button>${!isNew ? `<a class="btn ghost" href="#/p/${esc(p.slug)}" target="_blank">View</a><button class="btn danger" type="button" id="pdel">Delete</button>` : ''}</div>
    </form>`);
  wireMd($('#pf'));
  $('#pf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const row = { title: f.title.value.trim(), slug: slugify(f.slug.value || f.title.value), summary: f.summary.value.trim() || null, body: f.body.value, nav_order: +f.nav_order.value || 50, show_in_nav: f.show_in_nav.checked, published: f.published.checked };
    try {
      const r = isNew ? await must(sb.from('pages').insert(row).select('id').single()) : await must(sb.from('pages').update(row).eq('id', id).select('id').single());
      await loadNav(); toast('Saved'); if (isNew) go('#/admin/content/page/' + r.id);
    } catch (err) { fail(/duplicate key/.test(errMsg(err)) ? 'That address is already used by another page.' : err); }
  };
  $('#pdel')?.addEventListener('click', async () => { if (!confirm('Delete this page?')) return; try { await must(sb.from('pages').delete().eq('id', id)); await loadNav(); go('#/admin/content'); } catch (e) { fail(e); } });
}, ['super_admin', 'council_admin']);

adminRoute(/^#\/admin\/content\/post\/(new|[0-9a-f-]{36})(?:\?kind=(\w+))?$/, 'content', async (id, kind) => {
  const isNew = id === 'new';
  const p = isNew ? { kind: kind === 'submission' ? 'submission' : 'news', published: false, members_only: false, published_at: new Date().toISOString() } : await must(sb.from('posts').select('*').eq('id', id).single());
  const topics = p.kind === 'submission' ? ['Submission', 'Position paper', 'Consultation response'] : ['Announcement', 'Consultation', 'Industry issue', 'Update'];
  amain(`<p class="crumb"><a href="#/admin/content">← Website content</a></p><h1>${isNew ? (p.kind === 'submission' ? 'New submission' : 'New news item') : esc(p.title)}</h1>
    <form id="nf" class="card form">
      <div class="grid2">${field('Title *', `<input name="title" required value="${esc(p.title)}">`)}${field('Address (slug)', `<input name="slug" value="${esc(p.slug)}" placeholder="auto from title">`)}
        ${field('Type', `<select name="kind">${opt('news', 'Industry news', p.kind)}${opt('submission', 'Advocacy & submissions', p.kind)}</select>`)}
        ${field('Topic', `<input name="topic" list="topics" value="${esc(p.topic)}"><datalist id="topics">${topics.map(t => `<option value="${t}">`).join('')}</datalist>`)}
        ${field('Publish date', `<input name="published_at" type="datetime-local" value="${esc(toLocalDT(p.published_at))}">`)}
        ${field('Cover image URL', `<input name="cover_image" value="${esc(p.cover_image)}">`)}</div>
      ${field('Summary', `<textarea name="excerpt" rows="2">${esc(p.excerpt)}</textarea>`)}
      ${mdField('body', 'Content', p.body)}
      <div class="field"><span class="lbl">Attached document</span>
        <div class="row">${p.document_path ? `<span class="tag">📄 ${esc(p.document_name || p.document_path)}</span><button class="linklike small bad" type="button" id="docRm">Remove</button>` : '<span class="muted small">None</span>'}
        <input type="file" id="docFile" accept=".pdf,.doc,.docx,.xlsx,.pptx"></div>
        <small class="hint">Members-only items store their document privately — only logged-in member organisations can open it.</small></div>
      <div class="row">${chk('members_only', '1', p.members_only, 'Members only')}${chk('published', '1', p.published, 'Published')}</div>
      <div class="row"><button class="btn" type="submit">Save</button>${!isNew ? `<button class="btn danger" type="button" id="ndel">Delete</button>` : ''}</div>
    </form>`);
  wireMd($('#nf'));
  let doc = { path: p.document_path, name: p.document_name };
  $('#docRm')?.addEventListener('click', () => { doc = { path: null, name: null }; toast('Document will be removed when you save'); });
  $('#nf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try {
      const file = $('#docFile').files[0];
      if (file) {
        const bucket = f.members_only.checked ? 'member-docs' : 'public-docs';
        doc = { path: `${bucket}/` + await uploadFile(bucket, file, 'posts'), name: file.name };
      }
      const row = { kind: f.kind.value, title: f.title.value.trim(), slug: slugify(f.slug.value || f.title.value), topic: f.topic.value.trim() || null, excerpt: f.excerpt.value.trim() || null, body: f.body.value, cover_image: f.cover_image.value.trim() || null, published_at: f.published_at.value ? new Date(f.published_at.value).toISOString() : new Date().toISOString(), members_only: f.members_only.checked, published: f.published.checked, document_path: doc.path, document_name: doc.name };
      const r = isNew ? await must(sb.from('posts').insert(row).select('id').single()) : await must(sb.from('posts').update(row).eq('id', id).select('id').single());
      toast('Saved'); if (isNew) go('#/admin/content/post/' + r.id); else router();
    } catch (err) { fail(/duplicate key/.test(errMsg(err)) ? 'That address is already used.' : err); }
  };
  $('#ndel')?.addEventListener('click', async () => { if (!confirm('Delete this item?')) return; try { await must(sb.from('posts').delete().eq('id', id)); go('#/admin/content'); } catch (e) { fail(e); } });
}, ['super_admin', 'council_admin']);

/* =====================================================================
   ENQUIRIES
   ===================================================================== */
adminRoute(/^#\/admin\/enquiries$/, 'enq', async () => {
  const rows = await must(sb.from('enquiries').select('*').order('created_at', { ascending: false }).limit(300));
  amain(`<div class="ahead"><div><h1>Enquiries</h1><p class="muted">Messages from the website contact form.</p></div></div>
    ${rows.map(q => `<div class="card ${q.handled_at ? 'sub' : ''}">
      <div class="row between"><div><strong>${esc(q.name)}</strong> · <a href="mailto:${esc(q.email)}?subject=${encodeURIComponent('Re: ' + (q.subject || 'Your enquiry'))}">${esc(q.email)}</a>${q.phone ? ' · ' + esc(q.phone) : ''}${q.organisation ? `<br><span class="small">${esc(q.organisation)}</span>` : ''}</div>
        <span class="small muted">${fmtDateTime(q.created_at)}</span></div>
      ${q.subject ? `<h3 style="margin-top:10px">${esc(q.subject)}</h3>` : ''}
      <p style="white-space:pre-wrap">${esc(q.message)}</p>
      <div class="row"><input data-note="${q.id}" placeholder="Internal note" value="${esc(q.notes || '')}" style="max-width:420px">
        ${q.handled_at ? `<span class="small muted">Handled ${fmtDate(q.handled_at)}</span><button class="btn btn-xs ghost" data-reopen="${q.id}" type="button">Reopen</button>` : `<button class="btn btn-xs green" data-done="${q.id}" type="button">Mark handled</button>`}</div>
    </div>`).join('') || '<p class="muted">No enquiries yet.</p>'}`);
  const upd = async (id, patch) => { try { await must(sb.from('enquiries').update(patch).eq('id', id)); adminCounts.at = 0; router(); } catch (e) { fail(e); } };
  $$('[data-done]').forEach(b => b.onclick = () => upd(b.dataset.done, { handled_at: new Date().toISOString(), handled_by: S.session.user.id, notes: $(`[data-note="${b.dataset.done}"]`).value || null }));
  $$('[data-reopen]').forEach(b => b.onclick = () => upd(b.dataset.reopen, { handled_at: null, handled_by: null }));
  $$('[data-note]').forEach(i => i.onchange = () => sb.from('enquiries').update({ notes: i.value || null }).eq('id', i.dataset.note).then(({ error }) => error ? fail(error) : toast('Note saved')));
});

/* =====================================================================
   SETTINGS & LISTS
   ===================================================================== */
let setTab = 'council';
adminRoute(/^#\/admin\/settings$/, 'settings', async () => {
  await loadSettings(); await loadLookups(true);
  amain(`<div class="ahead"><div><h1>Settings &amp; lists</h1></div></div>
    <div class="tabs">${[['council', 'Council details'], ['email', 'Email'], ['lists', 'Lists'], ['metrics', 'Statistics measures'], ['consent', 'Consent wording'], ['security', 'Security']]
      .map(([k, l]) => `<button type="button" data-st="${k}" class="${setTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="stab"></div>`);
  $$('[data-st]').forEach(b => b.onclick = () => { setTab = b.dataset.st; $$('[data-st]').forEach(x => x.classList.toggle('active', x === b)); drawSettings(); });
  drawSettings();
}, ['super_admin', 'council_admin']);

async function saveSettings(patch) {
  try { await must(sb.from('site_settings').update(patch).eq('id', 1)); await loadSettings(); renderChrome(); toast('Settings saved'); } catch (e) { fail(e); }
}
function drawSettings() {
  const s = S.settings, el = $('#stab');
  if (setTab === 'council') {
    el.innerHTML = `<form class="card form" id="sf">
      <div class="grid2">${field('Council name', `<input name="council_name" value="${esc(s.council_name)}">`)}${field('Short name', `<input name="short_name" value="${esc(s.short_name)}">`)}</div>
      ${field('Tagline (home page headline)', `<input name="tagline" value="${esc(s.tagline)}">`)}
      <div class="grid2">${field('Public contact email', `<input name="contact_email" type="email" value="${esc(s.contact_email)}">`)}${field('Public phone', `<input name="contact_phone" value="${esc(s.contact_phone)}">`)}</div>
      ${field('Postal address', `<textarea name="postal_address" rows="2">${esc(s.postal_address)}</textarea>`)}
      ${mdField('home_priorities', 'Home page — current priorities', s.home_priorities, 6)}
      ${chk('directory_enabled', '1', s.directory_enabled, 'Show the public member directory (only organisations that consented are listed)')}
      <h2>Photos</h2><p class="small muted">Wide landscape photos work best (at least 1600 px wide). Use real Australian venues and events you have the rights to.</p>
      ${[['hero_image', 'Home hero / page header'], ['card_about_image', 'About card'], ['card_membership_image', 'Membership card'], ['card_advocacy_image', 'Advocacy card']].map(([k, l]) => `
        <div class="field"><span class="lbl">${l}</span><div class="row">${s[k] ? `<img src="${esc(s[k])}" alt="" style="width:120px;height:60px;object-fit:cover;border-radius:4px">` : '<span class="small muted">Default dark background</span>'}
          <input type="file" accept="image/*" data-photo="${k}" style="max-width:260px">${s[k] ? `<button class="linklike small bad" type="button" data-photo-rm="${k}">Remove</button>` : ''}</div></div>`).join('')}
      <button class="btn" type="submit">Save</button></form>`;
    $$('[data-photo]', el).forEach(inp => inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      if (file.size > 8 * 1024 * 1024) return toast('Photo must be under 8 MB.', 'err');
      try { const path = await uploadFile('public-docs', file, 'site'); await saveSettings({ [inp.dataset.photo]: publicUrl('public-docs', path) }); drawSettings(); } catch (e) { fail(e); }
    });
    $$('[data-photo-rm]', el).forEach(b => b.onclick = async () => { await saveSettings({ [b.dataset.photoRm]: null }); drawSettings(); });
    wireMd(el);
    $('#sf').onsubmit = e => { e.preventDefault(); const f = e.target; saveSettings({ council_name: f.council_name.value.trim(), short_name: f.short_name.value.trim(), tagline: f.tagline.value.trim(), contact_email: f.contact_email.value.trim() || null, contact_phone: f.contact_phone.value.trim() || null, postal_address: f.postal_address.value.trim() || null, home_priorities: f.home_priorities.value, directory_enabled: f.directory_enabled.checked }); };
  }
  if (setTab === 'email') {
    el.innerHTML = `<form class="card form" id="sf">
      <p class="small muted">The sending address must be on a domain verified in Resend (e.g. <code>council@mail.aimoc.org.au</code>).</p>
      <div class="grid2">${field('From name', `<input name="email_from_name" value="${esc(s.email_from_name)}">`)}${field('From address', `<input name="email_from_address" type="email" value="${esc(s.email_from_address)}">`)}</div>
      ${field('Reply-to address', `<input name="email_reply_to" type="email" value="${esc(s.email_reply_to)}">`, 'Replies go here — use the Council mailbox.')}
      ${field('Email footer', `<textarea name="email_footer" rows="3">${esc(s.email_footer)}</textarea>`, 'Required by the Spam Act: identify the Council and include a contact/postal address.')}
      ${chk('require_comms_approval', '1', s.require_comms_approval, 'Communications need approval by a Council Administrator before sending')}
      <button class="btn" type="submit">Save</button></form>`;
    $('#sf').onsubmit = e => { e.preventDefault(); const f = e.target; saveSettings({ email_from_name: f.email_from_name.value.trim(), email_from_address: f.email_from_address.value.trim() || null, email_reply_to: f.email_reply_to.value.trim() || null, email_footer: f.email_footer.value, require_comms_approval: f.require_comms_approval.checked }); };
  }
  if (setTab === 'security') {
    el.innerHTML = `<div class="card form"><h2>Administrator security</h2>
      ${chk('mfa', '1', s.require_admin_mfa, 'Require two-step verification for all Council staff (strongly recommended)', isSuper() ? '' : 'disabled')}
      ${isSuper() ? '' : '<p class="small muted">Only a Super Administrator can change this.</p>'}
      <p class="small">Backups: Supabase takes daily backups automatically (Pro plan adds point-in-time recovery). Use <a href="#/admin/export">Export all data</a> for your own offline copy.</p></div>`;
    $('[name=mfa]').onchange = e => { if (!e.target.checked && !confirm('Turn off two-step verification for administrators? This weakens security.')) { e.target.checked = true; return; } saveSettings({ require_admin_mfa: e.target.checked }); };
  }
  if (setTab === 'lists') {
    const list = (title, table, rows) => `<div class="card"><h2>${title}</h2>
      <table class="tbl compact"><thead><tr><th>Name</th><th style="width:90px">Order</th><th style="width:80px">Active</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-t="${table}" data-id="${r.id}"><td><input name="name" value="${esc(r.name)}"></td><td><input name="sort" type="number" value="${r.sort}"></td><td><input type="checkbox" name="active" ${r.active ? 'checked' : ''}></td><td><button class="btn btn-xs ghost" data-save type="button">Save</button></td></tr>`).join('')}
      <tr data-t="${table}" data-id=""><td><input name="name" placeholder="Add new…"></td><td><input name="sort" type="number" value="${(rows.at(-1)?.sort || 0) + 10}"></td><td><input type="checkbox" name="active" checked></td><td><button class="btn btn-xs" data-save type="button">Add</button></td></tr>
      </tbody></table><p class="small muted">Retire items by unticking Active — existing records keep them.</p></div>`;
    el.innerHTML = list('Organisation categories', 'org_categories', S.L.categories) + list('Motorsport disciplines', 'disciplines', S.L.disciplines) + list('Contact roles', 'contact_roles', S.L.roles);
    $$('[data-save]', el).forEach(b => b.onclick = async () => {
      const tr = b.closest('tr'), row = { name: $('[name=name]', tr).value.trim(), sort: +$('[name=sort]', tr).value || 100, active: $('[name=active]', tr).checked };
      if (!row.name) return;
      try { tr.dataset.id ? await must(sb.from(tr.dataset.t).update(row).eq('id', tr.dataset.id)) : await must(sb.from(tr.dataset.t).insert(row)); await loadLookups(true); toast('Saved'); drawSettings(); } catch (e) { fail(e); }
    });
  }
  if (setTab === 'metrics') {
    el.innerHTML = `<div class="card"><h2>Statistics measures (Section C)</h2>
      <p class="small muted"><strong>Kind</strong> controls how totals are labelled: <em>people</em> = unique individuals; <em>activity</em> = entries, events, attendance; <em>infrastructure</em> = venues; <em>network</em> = affiliated clubs. "Overlap" marks measures that can be double counted between affiliated organisations.</p>
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Key</th><th>Label</th><th>Help text</th><th>Kind</th><th>Overlap</th><th>Order</th><th>Active</th><th></th></tr></thead><tbody>
      ${[...S.L.metrics, { key: '', label: '', kind: 'people', overlap_sensitive: true, sort: (S.L.metrics.at(-1)?.sort || 0) + 10, active: true }].map(m => `<tr data-key="${esc(m.key)}">
        <td>${m.key ? `<code>${esc(m.key)}</code>` : '<input name="key" placeholder="new_key">'}</td><td><input name="label" value="${esc(m.label)}"></td><td><input name="description" value="${esc(m.description || '')}"></td>
        <td><select name="kind">${['people', 'activity', 'infrastructure', 'network'].map(k => opt(k, k, m.kind)).join('')}</select></td>
        <td><input type="checkbox" name="overlap_sensitive" ${m.overlap_sensitive ? 'checked' : ''}></td><td><input name="sort" type="number" value="${m.sort}" style="width:70px"></td>
        <td><input type="checkbox" name="active" ${m.active ? 'checked' : ''}></td><td><button class="btn btn-xs ${m.key ? 'ghost' : ''}" data-msave type="button">${m.key ? 'Save' : 'Add'}</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    $$('[data-msave]', el).forEach(b => b.onclick = async () => {
      const tr = b.closest('tr'), g = n => $(`[name=${n}]`, tr);
      const row = { label: g('label').value.trim(), description: g('description').value.trim() || null, kind: g('kind').value, overlap_sensitive: g('overlap_sensitive').checked, sort: +g('sort').value || 100, active: g('active').checked };
      try {
        if (tr.dataset.key) await must(sb.from('stat_metrics').update(row).eq('key', tr.dataset.key));
        else { const key = slugify(g('key').value).replace(/-/g, '_'); if (!key || !row.label) return toast('Enter a key and label', 'err'); await must(sb.from('stat_metrics').insert({ ...row, key })); }
        await loadLookups(true); toast('Saved'); drawSettings();
      } catch (e) { fail(e); }
    });
  }
  if (setTab === 'consent') {
    const versions = uniq(S.L.consentStatements.map(c => c.version)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    el.innerHTML = `<div class="card"><h2>Consent wording</h2>
      <p class="small muted">Current version: <strong>v${esc(s.consent_version)}</strong>. Every permission record keeps a copy of the exact wording agreed to. To change wording, create a new version, edit it, then make it current. Existing records are not changed.</p>
      <button class="btn btn-sm" id="newVer" type="button">Create new version from current</button></div>
      ${versions.map(v => `<div class="card"><div class="row between"><h3>Version ${esc(v)} ${v === s.consent_version ? '<span class="badge st-approved">Current</span>' : ''}</h3>
        ${v !== s.consent_version ? `<button class="btn btn-sm green" data-current="${esc(v)}" type="button">Make current</button>` : ''}</div>
        ${S.L.consentTypes.map(t => { const st = S.L.consentStatements.find(c => c.version === v && c.consent_key === t.key);
          return `<div class="field"><span class="lbl">${esc(t.label)}</span>${v === s.consent_version ? `<p class="small">${esc(st?.statement || '(missing)')}</p>` : `<textarea rows="2" data-v="${esc(v)}" data-k="${esc(t.key)}">${esc(st?.statement || '')}</textarea>`}</div>`; }).join('')}
        ${v !== s.consent_version ? `<button class="btn btn-sm ghost" data-savever="${esc(v)}" type="button">Save wording</button>` : ''}</div>`).join('')}`;
    $('#newVer').onclick = async () => {
      const v = prompt('New version number (e.g. 1.1):', ''); if (!v) return;
      const rows = S.L.consentTypes.map(t => ({ version: v.trim(), consent_key: t.key, statement: S.L.consentStatements.find(c => c.version === s.consent_version && c.consent_key === t.key)?.statement || '' }));
      try { await must(sb.from('consent_statements').insert(rows)); await loadLookups(true); drawSettings(); } catch (e) { fail(e); }
    };
    $$('[data-savever]', el).forEach(b => b.onclick = async () => {
      try { for (const ta of $$(`textarea[data-v="${b.dataset.savever}"]`, el)) await must(sb.from('consent_statements').upsert({ version: ta.dataset.v, consent_key: ta.dataset.k, statement: ta.value.trim() })); await loadLookups(true); toast('Wording saved'); } catch (e) { fail(e); }
    });
    $$('[data-current]', el).forEach(b => b.onclick = async () => {
      if (!confirm(`Make v${b.dataset.current} the current wording? New registrations and permission changes will use it.`)) return;
      if ($$(`textarea[data-v="${b.dataset.current}"]`, el).some(t => !t.value.trim())) return toast('Fill in every statement first.', 'err');
      await saveSettings({ consent_version: b.dataset.current }); drawSettings();
    });
  }
}

/* =====================================================================
   STAFF
   ===================================================================== */
adminRoute(/^#\/admin\/staff$/, 'staff', async () => {
  const rows = await must(sb.from('staff').select('*').order('created_at'));
  amain(`<div class="ahead"><div><h1>Staff</h1><p class="muted">Council administrators and communications editors.</p></div></div>
    <div class="card"><table class="tbl"><thead><tr><th>Name / email</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr data-u="${r.user_id}"><td><strong>${esc(r.full_name || '')}</strong><br><span class="small">${esc(r.email)}</span></td>
      <td><select name="role" ${r.user_id === S.session.user.id ? 'disabled' : ''}>${['super_admin', 'council_admin', 'comms_editor'].map(x => opt(x, ROLE_LABELS[x], r.role)).join('')}</select></td>
      <td><input type="checkbox" name="active" ${r.active ? 'checked' : ''} ${r.user_id === S.session.user.id ? 'disabled' : ''}></td>
      <td>${r.user_id === S.session.user.id ? '<span class="small muted">you</span>' : '<button class="btn btn-xs ghost" data-save type="button">Save</button>'}</td></tr>`).join('')}
    </tbody></table></div>
    <form class="card form" id="addStaff"><h2>Add staff member</h2>
      <p class="small muted">They must log in to the website once (using "Log in") before you can add them. They'll be asked to set up two-step verification.</p>
      <div class="grid3">${field('Email', '<input name="email" type="email" required>')}${field('Name', '<input name="name">')}${field('Role', `<select name="role">${['council_admin', 'comms_editor', 'super_admin'].map(x => opt(x, ROLE_LABELS[x])).join('')}</select>`)}</div>
      <button class="btn" type="submit">Add</button></form>
    <div class="card small"><h3>What each role can do</h3><ul>
      <li><strong>Super Administrator</strong> — everything, including staff and security settings.</li>
      <li><strong>Council Administrator</strong> — organisations, approvals, content, reporting, communications (including approving sends), settings.</li>
      <li><strong>Communications Editor</strong> — view organisations and reports; draft communications and submit them for approval.</li></ul></div>`);
  $$('[data-save]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr');
    try { await must(sb.from('staff').update({ role: $('[name=role]', tr).value, active: $('[name=active]', tr).checked }).eq('user_id', tr.dataset.u)); toast('Saved'); } catch (e) { fail(e); }
  });
  $('#addStaff').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const { error } = await sb.rpc('add_staff', { p_email: f.email.value, p_role: f.role.value, p_name: f.name.value || null });
    if (error) return fail(error);
    toast('Staff member added'); router();
  };
}, ['super_admin']);

/* =====================================================================
   EXPORT ALL DATA
   ===================================================================== */
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
async function fetchAll(table, select = '*', order) {
  const out = []; const size = 1000;
  for (let i = 0; ; i += size) {
    let q = sb.from(table).select(select).range(i, i + size - 1);
    if (order) q = q.order(order);
    const rows = await must(q);
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
const flatRows = rows => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])));

adminRoute(/^#\/admin\/export$/, 'export', async () => {
  amain(`<div class="ahead"><div><h1>Export all data</h1><p class="muted">Download a complete copy of AIMOC's records so the Council always controls its data.</p></div></div>
    <div class="card"><p>The workbook contains one sheet per table: organisations, contacts, statistics, permission history, communications, content, settings and the audit log.</p>
    <p class="notice small">This file contains personal information. Store it securely and don't email it.</p>
    <button class="btn" id="xAll" type="button">Download Excel workbook</button> <span id="xMsg" class="small muted"></span></div>`);
  $('#xAll').onclick = async () => {
    const btn = $('#xAll'); btn.disabled = true;
    try {
      await loadScript(XLSX_SRC);
      const wb = XLSX.utils.book_new();
      const tables = [['organisations', 'created_at'], ['organisation_categories'], ['organisation_disciplines'], ['organisation_affiliations'], ['contacts', 'created_at'], ['contact_role_links'], ['contact_disciplines'],
        ['stat_submissions', 'created_at'], ['stat_values'], ['organisation_consents', 'recorded_at'], ['org_categories', 'sort'], ['disciplines', 'sort'], ['contact_roles', 'sort'], ['stat_metrics', 'sort'],
        ['consent_types'], ['consent_statements'], ['campaigns', 'created_at'], ['campaign_recipients'], ['email_templates'], ['pages'], ['posts'], ['enquiries', 'created_at'], ['site_settings'], ['staff'], ['audit_log', 'at']];
      for (const [t, order] of tables) {
        $('#xMsg').textContent = `Reading ${t}…`;
        let rows = await fetchAll(t, '*', order);
        if (t === 'contacts') rows = rows.map(({ unsubscribe_token, ...r }) => r);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flatRows(rows).length ? flatRows(rows) : [{ note: 'no rows' }]), t.slice(0, 31));
      }
      XLSX.writeFile(wb, `aimoc-full-export-${today()}.xlsx`);
      $('#xMsg').textContent = 'Done.';
    } catch (e) { fail(e); $('#xMsg').textContent = ''; }
    btn.disabled = false;
  };
}, ['super_admin', 'council_admin']);
