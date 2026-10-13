/* =====================================================================
   AIMOC platform — comms.js
   Segmented email: compose, templates, audience builder, test, approval,
   scheduling, send via Resend (edge function), delivery reporting
   ===================================================================== */

const QUILL_JS = 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js';
const QUILL_CSS = 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css';
const CAMPAIGN_LABELS = { draft: 'Draft', pending_approval: 'Awaiting approval', approved: 'Approved', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', cancelled: 'Cancelled', failed: 'Failed', queued: 'Queued', delivered: 'Delivered', delayed: 'Delayed', opened: 'Opened', clicked: 'Clicked', bounced: 'Bounced', complained: 'Complained' };
const campaignBadge = s => `<span class="badge st-${esc(s)}">${esc(CAMPAIGN_LABELS[s] || s)}</span>`;
const MERGE_TAGS = [['{{first_name}}', 'First name'], ['{{full_name}}', 'Full name'], ['{{org_name}}', 'Organisation']];

function audienceSummary(a = {}) {
  const parts = [];
  if (a.contact_ids?.length) parts.push(`${a.contact_ids.length} selected contact(s)`);
  if (a.org_ids?.length) parts.push(`${a.org_ids.length} selected organisation(s)`);
  if (a.states?.length) parts.push(a.states.join('/') + (a.include_national === false ? '' : ' (+ national)'));
  if (a.category_ids?.length) parts.push(a.category_ids.map(id => nameOf(S.L.categories, id)).join(', '));
  if (a.discipline_ids?.length) parts.push(a.discipline_ids.map(id => nameOf(S.L.disciplines, id)).join(', '));
  if (a.role_ids?.length) parts.push('roles: ' + a.role_ids.map(id => nameOf(S.L.roles, id)).join(', '));
  if (a.principal_only) parts.push('lead contacts only');
  if (a.include_pending) parts.push('incl. pending orgs');
  return parts.length ? parts.join(' · ') : 'Entire membership';
}

/* ---------------- list ---------------- */
let commsTab = 'campaigns';
adminRoute(/^#\/admin\/comms$/, 'comms', async () => {
  const [camps, tpls] = await Promise.all([
    must(sb.from('campaigns').select('id,name,subject,status,category,audience,scheduled_at,sent_at,recipient_count,updated_at').order('updated_at', { ascending: false }).limit(300)),
    must(sb.from('email_templates').select('id,name,subject,updated_at').order('name')),
  ]);
  amain(`<div class="ahead"><div><h1>Communications</h1><p class="muted">Announcements, briefings and consultations to member organisations.</p></div>
      <a class="btn" href="#/admin/comms/new">+ New communication</a></div>
    <div class="tabs"><button type="button" data-ct="campaigns" class="${commsTab === 'campaigns' ? 'active' : ''}">Communications</button><button type="button" data-ct="templates" class="${commsTab === 'templates' ? 'active' : ''}">Templates (${tpls.length})</button></div>
    <div class="panel" id="p-campaigns" ${commsTab === 'campaigns' ? '' : 'hidden'}>
      <div class="filters"><select id="cf"><option value="">All</option>${Object.entries(CAMPAIGN_LABELS).slice(0, 8).map(([k, l]) => opt(k, l)).join('')}</select></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Communication</th><th>Audience</th><th>Status</th><th>When</th><th class="num">Recipients</th></tr></thead><tbody id="crows"></tbody></table></div>
    </div>
    <div class="panel" id="p-templates" ${commsTab === 'templates' ? '' : 'hidden'}>
      <p class="small muted">Create templates by writing an email and choosing "Save as template".</p>
      <table class="tbl"><tbody>${tpls.map(t => `<tr><td><strong>${esc(t.name)}</strong><br><span class="small muted">${esc(t.subject || '')}</span></td><td class="small muted">${fmtDate(t.updated_at)}</td>
        <td class="num"><button class="btn btn-xs ghost" data-use="${t.id}" type="button">Use</button> <button class="btn btn-xs danger" data-tdel="${t.id}" type="button">Delete</button></td></tr>`).join('') || '<tr><td class="muted">No templates yet.</td></tr>'}</tbody></table>
    </div>`);
  const draw = () => {
    const f = $('#cf').value;
    $('#crows').innerHTML = camps.filter(c => !f || c.status === f).map(c => `<tr class="click" data-href="#/admin/comms/${c.id}">
      <td><strong>${esc(c.name)}</strong>${c.category === 'promotional' ? ' <span class="tag soft">promotional</span>' : ''}<br><span class="small muted">${esc(c.subject)}</span></td>
      <td class="small">${esc(audienceSummary(c.audience))}</td><td>${campaignBadge(c.status)}</td>
      <td class="small">${c.sent_at ? fmtDateTime(c.sent_at) : c.scheduled_at ? fmtDateTime(c.scheduled_at) : 'edited ' + fmtDate(c.updated_at)}</td>
      <td class="num">${fmtNum(c.recipient_count)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet.</td></tr>';
    wireRowLinks($('#crows'));
  };
  $('#cf').onchange = draw; draw();
  $$('[data-ct]').forEach(b => b.onclick = () => { commsTab = b.dataset.ct; router(); });
  $$('[data-use]').forEach(b => b.onclick = async () => {
    try {
      const t = await must(sb.from('email_templates').select('*').eq('id', b.dataset.use).single());
      const c = await must(sb.from('campaigns').insert({ name: t.name, subject: t.subject || '', body_html: t.body_html }).select('id').single());
      go('#/admin/comms/' + c.id);
    } catch (e) { fail(e); }
  });
  $$('[data-tdel]').forEach(b => b.onclick = async () => { if (!confirm('Delete this template?')) return; try { await must(sb.from('email_templates').delete().eq('id', b.dataset.tdel)); router(); } catch (e) { fail(e); } });
});

adminRoute(/^#\/admin\/comms\/new(?:\?org=([0-9a-f-]{36}))?$/, 'comms', async orgId => {
  const audience = orgId ? { org_ids: [orgId], include_pending: true } : {};
  try {
    const c = await must(sb.from('campaigns').insert({ name: orgId ? 'Message to organisation' : 'Untitled communication', audience }).select('id').single());
    history.replaceState(null, '', location.pathname + '#/admin/comms/' + c.id);
    router();
  } catch (e) { fail(e); }
});

/* ---------------- editor / report ---------------- */
adminRoute(/^#\/admin\/comms\/([0-9a-f-]{36})$/, 'comms', async id => {
  const c = await must(sb.from('campaigns').select('*').eq('id', id).maybeSingle());
  if (!c) return amain('<p>Not found.</p>');
  if (['sending', 'sent', 'failed'].includes(c.status)) return campaignReport(c);
  await campaignEditor(c);
});

async function campaignEditor(c) {
  await Promise.all([loadScript(QUILL_JS), loadCss(QUILL_CSS)]);
  const [orgs, tpls] = await Promise.all([
    must(sb.from('organisations').select('id,legal_name,trading_name,state,status').in('status', ['approved', 'pending']).order('legal_name')),
    must(sb.from('email_templates').select('id,name').order('name')),
  ]);
  const a = { states: [], category_ids: [], discipline_ids: [], role_ids: [], org_ids: [], contact_ids: [], include_national: true, principal_only: false, include_pending: false, ...c.audience };
  let pickedContacts = [];
  if (a.contact_ids.length) pickedContacts = await must(sb.from('contacts').select('id,full_name,email,org_id').in('id', a.contact_ids));
  let attachments = [...(c.attachments || [])];
  const A = canAdmin(), needApproval = S.settings.require_comms_approval;
  const ids = arr => (arr || []).map(String);

  amain(`<p class="crumb"><a href="#/admin/comms">← Communications</a></p>
    <div class="ahead"><div><h1>${esc(c.name)}</h1><p class="small muted">${campaignBadge(c.status)}
      ${c.approved_at ? ` · approved ${fmtDateTime(c.approved_at)}` : ''}${c.status === 'scheduled' ? ` · sends ${fmtDateTime(c.scheduled_at)}` : ''}</p></div>
      <div class="row"><button class="btn btn-sm ghost" id="dup" type="button">Duplicate</button>${A && ['draft', 'cancelled'].includes(c.status) ? '<button class="btn btn-sm danger" id="cdel" type="button">Delete</button>' : ''}</div></div>
    ${['approved', 'scheduled'].includes(c.status) ? '<p class="notice small">Editing the subject, content or audience will return this communication to draft and it will need approval again.</p>' : ''}
    <div class="split" style="grid-template-columns:1.6fr 1fr;align-items:start">
      <div class="card form">
        <div class="grid2">${field('Internal name', `<input id="cName" value="${esc(c.name)}">`)}
          ${field('Type', `<select id="cCat">${opt('council', 'Council communication', c.category)}${opt('promotional', 'Optional news / promotional', c.category)}</select>`, 'Promotional emails only go to organisations that opted in.')}</div>
        ${field('Subject *', `<input id="cSubj" value="${esc(c.subject)}" maxlength="200">`)}
        ${field('Preview text', `<input id="cPre" value="${esc(c.preheader)}" maxlength="150">`, 'Shown after the subject in most inboxes.')}
        <div class="row between"><span class="lbl">Message</span>
          <div class="row">${MERGE_TAGS.map(([t, l]) => `<button class="chip" type="button" data-tag="${t}">+ ${l}</button>`).join('')}
          <select id="tplLoad" style="width:auto"><option value="">Load template…</option>${tpls.map(t => opt(t.id, t.name)).join('')}</select></div></div>
        <div id="qEditor"></div>
        <div class="field"><span class="lbl">Attachments (sent as secure download links)</span>
          <div id="attList" class="stack"></div>
          <input type="file" id="attFile" multiple></div>
        <div class="row"><button class="btn btn-sm ghost" id="saveTpl" type="button">Save as template</button><button class="btn btn-sm ghost" id="prev" type="button">Preview</button></div>
      </div>
      <div>
        <div class="card form">
          <h2>Audience</h2>
          <p class="audience-count"><span id="aCount">…</span> <span class="small muted">recipients</span> <button class="linklike small" id="aShow" type="button">show</button></p>
          <p class="small muted">Only contacts who receive Council communications and haven't unsubscribed or bounced. Each email address is sent once.</p>
          <fieldset><legend>State or territory</legend><div class="state-grid">${STATES.map(s => chk('a_states', s, a.states.includes(s), s)).join('')}</div>
            ${chk('a_nat', '1', a.include_national !== false, 'Include organisations operating nationally')}</fieldset>
          <details ${a.category_ids.length ? 'open' : ''}><summary>Organisation category</summary><div class="stack">${S.L.categories.map(x => chk('a_cats', x.id, ids(a.category_ids).includes(String(x.id)), esc(x.name))).join('')}</div></details>
          <details ${a.discipline_ids.length ? 'open' : ''}><summary>Discipline</summary><div class="stack">${S.L.disciplines.map(x => chk('a_discs', x.id, ids(a.discipline_ids).includes(String(x.id)), esc(x.name))).join('')}</div></details>
          <details ${a.role_ids.length ? 'open' : ''}><summary>Contact role</summary><div class="stack">${S.L.roles.map(x => chk('a_roles', x.id, ids(a.role_ids).includes(String(x.id)), esc(x.name))).join('')}</div></details>
          <details ${a.org_ids.length ? 'open' : ''}><summary>Specific organisations <span class="small muted" id="oCount"></span></summary>
            <input type="search" id="oSearch" placeholder="Filter…"><div class="pick-list" id="oPick">${orgs.map(o => `<label class="check small" data-name="${esc(orgName(o).toLowerCase())}"><input type="checkbox" name="a_orgs" value="${o.id}" ${a.org_ids.includes(o.id) ? 'checked' : ''}> ${esc(orgName(o))} <span class="muted">${esc(o.state || '')}${o.status === 'pending' ? ' · pending' : ''}</span></label>`).join('')}</div></details>
          <details ${a.contact_ids.length ? 'open' : ''}><summary>Specific people</summary>
            <input type="search" id="pSearch" placeholder="Search name or email…"><div id="pResults" class="stack small"></div><div id="pPicked" class="tags"></div></details>
          <div class="stack">${chk('a_principal', '1', a.principal_only, 'Lead contacts only')}${chk('a_pending', '1', a.include_pending, 'Include organisations awaiting approval')}</div>
          <p class="small muted" id="aSummary"></p>
        </div>
        <div class="card form" id="actions"></div>
      </div>
    </div>`);

  // editor
  const quill = new Quill('#qEditor', { theme: 'snow', modules: { toolbar: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link', 'blockquote'], ['clean']] } });
  quill.clipboard.dangerouslyPasteHTML(cleanHtml(c.body_html || ''));
  $$('[data-tag]').forEach(b => b.onclick = () => { const r = quill.getSelection(true); quill.insertText(r ? r.index : quill.getLength() - 1, b.dataset.tag); });
  $('#tplLoad').onchange = async e => {
    if (!e.target.value) return;
    if (quill.getText().trim() && !confirm('Replace the current subject and message with this template?')) { e.target.value = ''; return; }
    const t = await must(sb.from('email_templates').select('*').eq('id', e.target.value).single());
    if (t.subject) $('#cSubj').value = t.subject;
    quill.setContents([]); quill.clipboard.dangerouslyPasteHTML(cleanHtml(t.body_html)); e.target.value = '';
  };
  $('#saveTpl').onclick = async () => {
    const name = prompt('Template name:', $('#cName').value); if (!name) return;
    try { await must(sb.from('email_templates').insert({ name, subject: $('#cSubj').value, body_html: cleanHtml(quill.root.innerHTML) })); toast('Template saved'); } catch (e) { fail(e); }
  };

  // attachments
  const drawAtt = () => { $('#attList').innerHTML = attachments.map((x, i) => `<div class="row small">📎 <a href="${safeUrl(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a> <span class="muted">${fmtNum(Math.round((x.size || 0) / 1024))} KB</span> <button class="linklike bad" data-arm="${i}" type="button">remove</button></div>`).join('') || '<span class="small muted">None</span>'; };
  drawAtt();
  $('#attList').onclick = e => { const b = e.target.closest('[data-arm]'); if (b) { attachments.splice(+b.dataset.arm, 1); drawAtt(); } };
  $('#attFile').onchange = async e => {
    for (const file of e.target.files) {
      if (file.size > 20 * 1024 * 1024) { toast(`${file.name} is over 20 MB`, 'err'); continue; }
      try { const path = await uploadFile('public-docs', file, 'comms/' + c.id); attachments.push({ name: file.name, path: 'public-docs/' + path, url: publicUrl('public-docs', path), size: file.size }); }
      catch (err) { fail(err); }
    }
    e.target.value = ''; drawAtt();
  };

  // audience
  const readAudience = () => ({
    states: checkedValues(document, 'a_states'), include_national: $('[name=a_nat]').checked,
    category_ids: checkedValues(document, 'a_cats').map(Number), discipline_ids: checkedValues(document, 'a_discs').map(Number),
    role_ids: checkedValues(document, 'a_roles').map(Number), org_ids: checkedValues(document, 'a_orgs'),
    contact_ids: pickedContacts.map(p => p.id), principal_only: $('[name=a_principal]').checked, include_pending: $('[name=a_pending]').checked,
  });
  let lastAudience = [];
  const refreshCount = debounce(async () => {
    const aud = readAudience();
    $('#aSummary').textContent = audienceSummary(aud);
    $('#oCount').textContent = aud.org_ids.length ? `(${aud.org_ids.length})` : '';
    const { data, error } = await sb.rpc('campaign_audience', { a: { ...aud, category: $('#cCat').value } });
    if (error) { $('#aCount').textContent = '?'; return fail(error); }
    lastAudience = data || [];
    $('#aCount').textContent = fmtNum(lastAudience.length);
  }, 300);
  $('#amain').addEventListener('change', e => { if (e.target.name?.startsWith('a_') || e.target.id === 'cCat') refreshCount(); });
  $('#oSearch').oninput = e => { const q = e.target.value.toLowerCase(); $$('#oPick label').forEach(l => { l.hidden = q && !l.dataset.name.includes(q); }); };
  const drawPicked = () => { $('#pPicked').innerHTML = pickedContacts.map(p => `<span class="tag">${esc(p.full_name)} <button class="linklike" data-unpick="${p.id}" type="button" aria-label="Remove">×</button></span>`).join(''); };
  drawPicked();
  $('#pPicked').onclick = e => { const b = e.target.closest('[data-unpick]'); if (b) { pickedContacts = pickedContacts.filter(p => p.id !== b.dataset.unpick); drawPicked(); refreshCount(); } };
  $('#pSearch').oninput = debounce(async e => {
    const q = e.target.value.trim().replace(/[%,()]/g, ''); if (q.length < 2) { $('#pResults').innerHTML = ''; return; }
    const rows = await must(sb.from('contacts').select('id,full_name,email,org_id,organisations(legal_name,trading_name)').or(`full_name.ilike.%${q}%,email.ilike.%${q}%`).eq('active', true).limit(10));
    $('#pResults').innerHTML = rows.map(r => `<button class="linklike" type="button" data-pick='${esc(JSON.stringify({ id: r.id, full_name: r.full_name, email: r.email }))}'>+ ${esc(r.full_name)} — ${esc(orgName(r.organisations))}</button>`).join('') || '<span class="muted">No matches</span>';
  });
  $('#pResults').onclick = e => { const b = e.target.closest('[data-pick]'); if (!b) return; const p = JSON.parse(b.dataset.pick); if (!pickedContacts.some(x => x.id === p.id)) pickedContacts.push(p); drawPicked(); refreshCount(); };
  $('#aShow').onclick = () => modal(`<h2>Recipients (${lastAudience.length})</h2><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Name</th><th>Email</th><th>Organisation</th></tr></thead><tbody>
    ${lastAudience.map(r => `<tr><td>${esc(r.full_name)}${r.is_principal ? ' <span class="tag">Lead</span>' : ''}</td><td class="small">${esc(r.email)}</td><td class="small">${esc(r.org_name)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nobody matches.</td></tr>'}</tbody></table></div>`, { wide: true });
  refreshCount();

  // save + actions
  const collect = () => ({
    name: $('#cName').value.trim() || 'Untitled communication', category: $('#cCat').value,
    subject: $('#cSubj').value.trim(), preheader: $('#cPre').value.trim() || null,
    body_html: cleanHtml(quill.root.innerHTML), attachments, audience: readAudience(),
  });
  const save = async (extra = {}) => must(sb.from('campaigns').update({ ...collect(), ...extra }).eq('id', c.id).select('*').single());
  const run = (fn, msg) => async () => { try { await fn(); if (msg) toast(msg); adminCounts.at = 0; router(); } catch (e) { fail(e); } };
  const validate = () => {
    const d = collect();
    if (!d.subject) throw new Error('Add a subject line.');
    if (!quill.getText().trim()) throw new Error('The message is empty.');
    return d;
  };

  const btns = [];
  const b = (id, label, cls = 'ghost') => { btns.push(`<button class="btn ${cls}" id="${id}" type="button">${label}</button>`); };
  b('aSave', 'Save draft');
  b('aTest', 'Send test to me');
  if (c.status === 'draft' || c.status === 'cancelled') {
    if (needApproval && !A) b('aSubmit', 'Submit for approval', 'gold');
    if (needApproval && A) b('aApprove', 'Approve', 'green');
    if (!needApproval) { b('aSched', 'Schedule…'); b('aSend', 'Send now', 'gold'); }
  }
  if (c.status === 'pending_approval') { if (A) b('aApprove', 'Approve', 'green'); b('aDraft', A ? 'Return to draft' : 'Withdraw'); }
  if (c.status === 'approved') { b('aSched', 'Schedule…'); b('aSend', 'Send now', 'gold'); b('aDraft', 'Return to draft'); }
  if (c.status === 'scheduled') b('aDraft', 'Cancel scheduled send', 'danger');
  $('#actions').innerHTML = `<h2>Send</h2>
    ${needApproval ? '<p class="small muted">Approval by a Council Administrator is required before sending.</p>' : ''}
    <div class="stack">${btns.join('')}</div>
    <div id="schedBox" hidden class="form"><input type="datetime-local" id="schedAt" value="${esc(toLocalDT(c.scheduled_at || new Date(Date.now() + 36e5).toISOString()))}"><button class="btn" id="schedGo" type="button">Confirm schedule</button></div>`;

  $('#aSave').onclick = run(() => save(), 'Draft saved');
  $('#aTest').onclick = async () => {
    try {
      validate(); await save();
      const to = prompt('Send a test to:', S.session.user.email); if (!to) return;
      const { data, error } = await sb.functions.invoke('send-campaign', { body: { campaign_id: c.id, test_to: to } });
      if (error || data?.error) throw new Error(data?.error || errMsg(error));
      toast('Test sent to ' + to);
    } catch (e) { fail(e); }
  };
  $('#aSubmit')?.addEventListener('click', run(async () => { validate(); await save(); await must(sb.from('campaigns').update({ status: 'pending_approval' }).eq('id', c.id)); }, 'Submitted for approval'));
  $('#aApprove')?.addEventListener('click', run(async () => { validate(); await save(); await must(sb.from('campaigns').update({ status: 'approved' }).eq('id', c.id)); }, 'Approved'));
  $('#aDraft')?.addEventListener('click', run(() => must(sb.from('campaigns').update({ status: 'draft' }).eq('id', c.id)), 'Returned to draft'));
  $('#aSched')?.addEventListener('click', () => { $('#schedBox').hidden = false; });
  $('#schedGo')?.addEventListener('click', run(async () => {
    validate();
    const when = $('#schedAt').value; if (!when) throw new Error('Choose a date and time.');
    await save();
    await must(sb.from('campaigns').update({ status: 'scheduled', scheduled_at: new Date(when).toISOString() }).eq('id', c.id));
  }, 'Scheduled'));
  $('#aSend')?.addEventListener('click', async () => {
    try {
      validate(); await save();
      if (!lastAudience.length) throw new Error('Nobody matches this audience.');
      if (!confirm(`Send "${$('#cSubj').value}" to ${lastAudience.length} recipient(s) now? This can't be undone.`)) return;
      $('#aSend').disabled = true; $('#aSend').textContent = 'Sending…';
      const { data, error } = await sb.functions.invoke('send-campaign', { body: { campaign_id: c.id } });
      if (error || data?.error) throw new Error(data?.error || errMsg(error));
      toast(`Sent to ${data.sent} recipient(s)${data.failed ? `, ${data.failed} failed` : ''}`);
      adminCounts.at = 0; router();
    } catch (e) { fail(e); router(); }
  });
  $('#prev').onclick = () => { const d = collect(); modal(`<h2>Preview</h2><p class="small"><strong>Subject:</strong> ${esc(d.subject)}</p><div class="email-preview">${emailPreviewHtml(d)}</div>`, { wide: true }); };
  $('#dup').onclick = run(async () => {
    const d = collect();
    const n = await must(sb.from('campaigns').insert({ ...d, name: d.name + ' (copy)' }).select('id').single());
    history.replaceState(null, '', location.pathname + '#/admin/comms/' + n.id);
  }, 'Duplicated');
  $('#cdel')?.addEventListener('click', async () => { if (!confirm('Delete this communication?')) return; try { await must(sb.from('campaigns').delete().eq('id', c.id)); go('#/admin/comms'); } catch (e) { fail(e); } });
}

/** Approximate the delivered email (the edge function builds the real one). */
function emailPreviewHtml(d) {
  const s = S.settings;
  const sample = { '{{first_name}}': 'Alex', '{{full_name}}': 'Alex Example', '{{org_name}}': 'Example Motorsport Club Inc' };
  const body = Object.entries(sample).reduce((h, [k, v]) => h.split(k).join(esc(v)), d.body_html);
  return `<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #dfe4ea;font-family:Arial,sans-serif">
    <div style="background:#0B0D0F;padding:16px 24px"><img src="assets/email-logo.png" width="150" alt="AIMOC" style="display:block"></div>
    <div style="height:4px;background:#FFC400"></div>
    <div style="padding:24px;font-size:15px;line-height:1.6;color:#1B1F24">${body}
      ${d.attachments?.length ? `<p><strong>Attachments</strong><br>${d.attachments.map(a => `📎 <a href="${safeUrl(a.url)}">${esc(a.name)}</a>`).join('<br>')}</p>` : ''}</div>
    <div style="padding:16px 24px;background:#f4f6f9;font-size:12px;color:#5b6676">${esc(s.email_footer || '')}<br>You're receiving this as a contact for Example Motorsport Club Inc. <u>Unsubscribe</u></div></div>`;
}

/* ---------------- report ---------------- */
async function campaignReport(c) {
  const mine = await must(sb.from('campaign_recipients').select('email,full_name,org_name,status,error,sent_at,last_event_at').eq('campaign_id', c.id).order('org_name').limit(10000));
  const counts = {}; mine.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  amain(`<p class="crumb"><a href="#/admin/comms">← Communications</a></p>
    <div class="ahead"><div><h1>${esc(c.name)}</h1><p class="small muted">${campaignBadge(c.status)} · sent ${fmtDateTime(c.sent_at)} · ${esc(audienceSummary(c.audience))}</p></div>
      <div class="row"><button class="btn btn-sm ghost" id="rRefresh" type="button">Refresh</button><button class="btn btn-sm ghost" id="rCsv" type="button">Export CSV</button><button class="btn btn-sm ghost" id="dup2" type="button">Duplicate</button></div></div>
    ${c.error ? `<p class="notice err small">${esc(c.error)}</p>` : ''}
    <div class="kpis">
      <div class="kpi"><strong>${fmtNum(mine.length)}</strong><span>Recipients</span></div>
      <div class="kpi"><strong>${fmtNum((counts.delivered || 0) + (counts.opened || 0) + (counts.clicked || 0))}</strong><span>Delivered</span></div>
      <div class="kpi"><strong>${fmtNum(counts.sent || 0)}</strong><span>Sent, awaiting confirmation</span></div>
      <div class="kpi ${counts.bounced ? 'alert' : ''}"><strong>${fmtNum(counts.bounced || 0)}</strong><span>Bounced</span></div>
      <div class="kpi ${counts.failed ? 'alert' : ''}"><strong>${fmtNum(counts.failed || 0)}</strong><span>Failed</span></div>
      <div class="kpi"><strong>${fmtNum(counts.complained || 0)}</strong><span>Spam complaints</span></div>
    </div>
    <div class="split" style="grid-template-columns:1.3fr 1fr;align-items:start">
      <div class="table-wrap"><table class="tbl compact"><thead><tr><th>Recipient</th><th>Organisation</th><th>Status</th><th>Last update</th></tr></thead><tbody>
        ${mine.map(r => `<tr><td>${esc(r.full_name || '')}<br><span class="small muted">${esc(r.email)}</span></td><td class="small">${esc(r.org_name || '')}</td>
          <td>${campaignBadge(r.status)}${r.error ? `<br><span class="small bad">${esc(r.error)}</span>` : ''}</td><td class="small">${fmtDateTime(r.last_event_at || r.sent_at)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card"><p class="small"><strong>Subject:</strong> ${esc(c.subject)}</p><div class="email-preview">${emailPreviewHtml(c)}</div></div>
    </div>`);
  if (c.status === 'failed') {
    $('#rRefresh').insertAdjacentHTML('beforebegin', '<button class="btn btn-sm gold" id="rRetry" type="button">Retry failed recipients</button>');
    $('#rRetry').onclick = async () => {
      if (!confirm('Retry sending to recipients that failed?')) return;
      $('#rRetry').disabled = true;
      const { data, error } = await sb.functions.invoke('send-campaign', { body: { campaign_id: c.id } });
      if (error || data?.error) fail(data?.error || error); else toast(`Sent ${data.sent}${data.failed ? `, ${data.failed} still failing` : ''}`);
      router();
    };
  }
  $('#rRefresh').onclick = () => router();
  $('#rCsv').onclick = () => downloadCsv(mine, [{ label: 'Name', key: 'full_name' }, { label: 'Email', key: 'email' }, { label: 'Organisation', key: 'org_name' }, { label: 'Status', key: 'status' }, { label: 'Error', key: 'error' }, { label: 'Sent', get: r => fmtDateTime(r.sent_at) }, { label: 'Last update', get: r => fmtDateTime(r.last_event_at) }], `aimoc-send-${slugify(c.name)}-${today()}.csv`);
  $('#dup2').onclick = async () => {
    try { const n = await must(sb.from('campaigns').insert({ name: c.name + ' (copy)', category: c.category, subject: c.subject, preheader: c.preheader, body_html: c.body_html, attachments: c.attachments, audience: c.audience }).select('id').single()); go('#/admin/comms/' + n.id); } catch (e) { fail(e); }
  };
}
