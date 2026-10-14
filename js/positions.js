/* =====================================================================
   AIMOC platform — positions.js
   Council positions: draft → open for review (endorse / opt out) → close
   → final. Silence is never treated as endorsement.
   Admin: #/admin/positions, #/admin/position/:id
   Members: #/portal/position/:id (+ list on #/portal)
   ===================================================================== */

const POS_LABELS = { draft: 'Draft', open: 'Open for review', closed: 'Review closed', final: 'Final', withdrawn: 'Withdrawn' };
const RESP_LABELS = { endorse: 'Endorsed', opt_out: 'Opted out', no_response: 'No endorsement recorded', withdrawn: 'Response withdrawn' };
const posBadge = s => `<span class="badge st-pos-${esc(s)}">${esc(POS_LABELS[s] || s)}</span>`;
const respBadge = s => `<span class="badge st-resp-${esc(s)}">${esc(RESP_LABELS[s] || s)}</span>`;
const fmtClose = d => (d ? new Date(d).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' AEST' : '');

/** Client-side preview of the server's add_business_days (end of Nth Mon–Fri, Brisbane). */
function previewClose(days) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Brisbane' }));
  let n = 0;
  while (n < days) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', 11:59 pm';
}

async function invokeSend(body) {
  const { data, error } = await sb.functions.invoke('send-campaign', { body });
  if (error || data?.error) {
    let msg = data?.error;
    if (!msg && error?.context?.json) { try { msg = (await error.context.json()).error; } catch {} }
    throw new Error(msg || errMsg(error));
  }
  return data;
}

function matchOrgs(orgs, a) {
  const states = a.states || [], cats = (a.category_ids || []).map(String), discs = (a.discipline_ids || []).map(String), ids = a.org_ids || [];
  return orgs.filter(o =>
    (!states.length || states.includes(o.state) || (o.operating_states || []).some(s => states.includes(s)) || (a.include_national !== false && (o.operating_states || []).includes('National'))) &&
    (!cats.length || o.organisation_categories.some(c => cats.includes(String(c.category_id)))) &&
    (!discs.length || o.organisation_disciplines.some(d => discs.includes(String(d.discipline_id)))) &&
    (!ids.length || ids.includes(o.id)));
}

/* ---------------- admin: list ---------------- */
adminRoute(/^#\/admin\/positions$/, 'positions', async () => {
  const [ps, recips, resps] = await Promise.all([
    must(sb.from('council_positions').select('id,title,jurisdiction,status,version,closes_at,opened_at,finalised_at,updated_at').order('updated_at', { ascending: false })),
    must(sb.from('position_recipients').select('position_id')),
    must(sb.from('position_response_current').select('position_id,response')),
  ]);
  const tally = {};
  recips.forEach(r => { (tally[r.position_id] ||= { asked: 0, endorse: 0, opt_out: 0 }).asked++; });
  resps.forEach(r => { const t = tally[r.position_id]; if (t && t[r.response] !== undefined) t[r.response]++; });
  amain(`<div class="ahead"><div><h1>Council positions</h1><p class="muted">Positions sent to member organisations to endorse or opt out. No response means no endorsement.</p></div>
      ${canAdmin() ? '<a class="btn" href="#/admin/positions/new">+ New position</a>' : ''}</div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Position</th><th>Status</th><th>Review closes</th><th class="num">Asked</th><th class="num">Endorsed</th><th class="num">Opted out</th><th class="num">No endorsement</th></tr></thead><tbody>
    ${ps.map(p => { const t = tally[p.id] || { asked: 0, endorse: 0, opt_out: 0 };
      return `<tr class="click" data-href="#/admin/position/${p.id}"><td><strong>${esc(p.title)}</strong>${p.jurisdiction ? `<br><span class="small muted">${esc(p.jurisdiction)}</span>` : ''}${p.version > 1 ? ` <span class="tag soft">v${p.version}</span>` : ''}</td>
        <td>${posBadge(p.status)}</td><td class="small">${p.closes_at ? fmtClose(p.closes_at) : '—'}</td>
        <td class="num">${p.status === 'draft' ? '—' : t.asked}</td><td class="num">${p.status === 'draft' ? '—' : t.endorse}</td><td class="num">${p.status === 'draft' ? '—' : t.opt_out}</td>
        <td class="num">${p.status === 'draft' ? '—' : t.asked - t.endorse - t.opt_out}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No positions yet.</td></tr>'}
    </tbody></table></div>`);
  wireRowLinks();
});

adminRoute(/^#\/admin\/positions\/new$/, 'positions', async () => {
  try {
    const p = await must(sb.from('council_positions').insert({ title: 'Untitled position', review_business_days: 5 }).select('id').single());
    history.replaceState(null, '', location.pathname + '#/admin/position/' + p.id);
    router();
  } catch (e) { fail(e); }
}, ['super_admin', 'council_admin']);

adminRoute(/^#\/admin\/position\/([0-9a-f-]{36})$/, 'positions', async id => {
  const p = await must(sb.from('council_positions').select('*').eq('id', id).maybeSingle());
  if (!p) return amain('<p>Position not found.</p>');
  if (p.status === 'draft') return positionEditor(p);
  return positionResults(p);
});

/* ---------------- admin: draft editor ---------------- */
async function positionEditor(p) {
  const A = canAdmin();
  const orgs = await must(sb.from('organisations').select('id,legal_name,trading_name,state,operating_states,organisation_categories(category_id),organisation_disciplines(discipline_id)').eq('status', 'approved').order('legal_name'));
  const a = { states: [], category_ids: [], discipline_ids: [], org_ids: [], include_national: true, ...p.audience };
  const ids = arr => (arr || []).map(String);
  let doc = p.document_path ? { path: p.document_path, name: p.document_name } : null;

  amain(`<p class="crumb"><a href="#/admin/positions">← Council positions</a></p>
    <div class="ahead"><div><h1>${esc(p.title)}</h1><p class="small muted">${posBadge(p.status)} · created ${fmtDate(p.created_at)}</p></div>
      <div class="row">${A ? '<button class="btn btn-sm danger" id="pDel" type="button">Delete draft</button>' : ''}</div></div>
    <div class="split" style="grid-template-columns:1.6fr 1fr;align-items:start">
      <form class="card form" id="pf">
        ${field('Title *', `<input name="title" required maxlength="200" value="${esc(p.title)}">`)}
        ${field('Directed to', `<input name="jurisdiction" maxlength="200" value="${esc(p.jurisdiction)}" placeholder="e.g. Queensland Government — Department of Transport">`)}
        ${field('Short summary', `<textarea name="summary" rows="3" maxlength="600">${esc(p.summary)}</textarea>`, 'Shown in the notification email.')}
        ${mdField('body', 'Position text *', p.body, 18)}
        <div class="field"><span class="lbl">Supporting document (optional, members only)</span><div id="pDoc" class="small"></div><input type="file" id="pDocFile" accept=".pdf,.doc,.docx"></div>
      </form>
      <div>
        <div class="card form">
          <h2>Review period</h2>
          ${field('Business days to respond', `<input id="pDays" type="number" min="1" max="60" value="${esc(p.review_business_days)}">`)}
          <p class="small">If opened today, review closes <strong id="pClose"></strong> (Brisbane time). A reminder goes to non-responders at 9 am on the last day.</p>
        </div>
        <div class="card form">
          <h2>Organisations asked</h2>
          <p class="audience-count"><span id="pCount">…</span> <span class="small muted">approved organisations</span> <button class="linklike small" id="pShow" type="button">show</button></p>
          <p class="small muted">The list is fixed when the position opens. Leave everything unticked to ask every approved organisation.</p>
          <fieldset><legend>State or territory</legend><div class="state-grid">${STATES.map(s => chk('p_states', s, a.states.includes(s), s)).join('')}</div>
            ${chk('p_nat', '1', a.include_national !== false, 'Include organisations operating nationally')}</fieldset>
          <details ${a.category_ids.length ? 'open' : ''}><summary>Organisation category</summary><div class="stack">${S.L.categories.map(x => chk('p_cats', x.id, ids(a.category_ids).includes(String(x.id)), esc(x.name))).join('')}</div></details>
          <details ${a.discipline_ids.length ? 'open' : ''}><summary>Discipline</summary><div class="stack">${S.L.disciplines.map(x => chk('p_discs', x.id, ids(a.discipline_ids).includes(String(x.id)), esc(x.name))).join('')}</div></details>
          <details ${a.org_ids.length ? 'open' : ''}><summary>Specific organisations</summary>
            <input type="search" id="poSearch" placeholder="Filter…"><div class="pick-list" id="poPick">${orgs.map(o => `<label class="check small" data-name="${esc(orgName(o).toLowerCase())}"><input type="checkbox" name="p_orgs" value="${o.id}" ${a.org_ids.includes(o.id) ? 'checked' : ''}> ${esc(orgName(o))} <span class="muted">${esc(o.state || '')}</span></label>`).join('')}</div></details>
        </div>
        <div class="card form"><h2>Actions</h2><div class="stack">
          <button class="btn ghost" id="pSave" type="button">Save draft</button>
          <button class="btn ghost" id="pPrev" type="button">Preview</button>
          ${A ? '<button class="btn gold" id="pOpen" type="button">Open for review &amp; notify…</button>' : '<p class="small muted">A Council Administrator opens positions for review.</p>'}
        </div></div>
      </div>
    </div>`);
  wireMd($('#pf'));

  const readAud = () => ({
    states: checkedValues(document, 'p_states'), include_national: $('[name=p_nat]').checked,
    category_ids: checkedValues(document, 'p_cats').map(Number), discipline_ids: checkedValues(document, 'p_discs').map(Number),
    org_ids: checkedValues(document, 'p_orgs'),
  });
  let matched = [];
  const refresh = () => {
    matched = matchOrgs(orgs, readAud());
    $('#pCount').textContent = fmtNum(matched.length);
    $('#pClose').textContent = previewClose(Math.max(1, Math.min(60, +$('#pDays').value || 5)));
  };
  $('#amain').addEventListener('change', e => { if (e.target.name?.startsWith('p_') || e.target.id === 'pDays') refresh(); });
  $('#pDays').oninput = refresh;
  $('#poSearch').oninput = e => { const q = e.target.value.toLowerCase(); $$('#poPick label').forEach(l => { l.hidden = q && !l.dataset.name.includes(q); }); };
  $('#pShow').onclick = () => modal(`<h2>Organisations asked (${matched.length})</h2><ul class="plain">${matched.map(o => `<li>${esc(orgName(o))} <span class="small muted">${esc(o.state || '')}</span></li>`).join('') || '<li class="muted">None match.</li>'}</ul>`);
  refresh();

  const drawDoc = () => { $('#pDoc').innerHTML = doc ? `📎 ${esc(doc.name)} <button class="linklike bad" id="pDocRm" type="button">remove</button>` : '<span class="muted">None</span>'; $('#pDocRm')?.addEventListener('click', () => { doc = null; drawDoc(); }); };
  drawDoc();
  $('#pDocFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast('Files must be under 20 MB', 'err');
    try { const path = await uploadFile('member-docs', file, 'positions/' + p.id); doc = { path: 'member-docs/' + path, name: file.name }; drawDoc(); }
    catch (err) { fail(err); }
    e.target.value = '';
  };

  const f = $('#pf');
  const collect = () => ({
    title: f.title.value.trim() || 'Untitled position', jurisdiction: f.jurisdiction.value.trim() || null, summary: f.summary.value.trim() || null,
    body: f.body.value, review_business_days: Math.max(1, Math.min(60, +$('#pDays').value || 5)), audience: readAud(),
    document_path: doc?.path || null, document_name: doc?.name || null,
  });
  const save = () => must(sb.from('council_positions').update(collect()).eq('id', p.id));
  $('#pSave').onclick = async () => { try { await save(); toast('Draft saved'); router(); } catch (e) { fail(e); } };
  $('#pPrev').onclick = () => { const d = collect(); modal(`<h2>${esc(d.title)}</h2>${d.jurisdiction ? `<p class="muted">${esc(d.jurisdiction)}</p>` : ''}${d.summary ? `<p><strong>${esc(d.summary)}</strong></p>` : ''}<div class="prose">${md(d.body)}</div>`, { wide: true }); };
  $('#pDel')?.addEventListener('click', async () => { if (!confirm('Delete this draft position?')) return; try { await must(sb.from('council_positions').delete().eq('id', p.id)); go('#/admin/positions'); } catch (e) { fail(e); } });
  $('#pOpen')?.addEventListener('click', async () => {
    const d = collect();
    if (!d.body.trim()) return toast('Add the position text first.', 'err');
    if (!matched.length) return toast('No approved organisations match.', 'err');
    if (!confirm(`Open "${d.title}" for review?\n\n• ${matched.length} organisation(s) will be emailed now\n• Review closes ${previewClose(d.review_business_days)} (Brisbane)\n• Organisations that don't respond are recorded as "No endorsement".\n\nThe list of organisations is fixed once opened.`)) return;
    const btn = $('#pOpen'); btn.disabled = true; btn.textContent = 'Opening…';
    try {
      await save();
      const r = await must(sb.rpc('open_position', { p_id: p.id }));
      btn.textContent = 'Sending emails…';
      try {
        const s = await invokeSend({ position_id: p.id, kind: 'notice' });
        toast(`Opened. ${s.organisations} of ${r.recipients} organisation(s) emailed.`);
      } catch (e) { toast('Opened, but the emails failed: ' + errMsg(e) + ' — use "Send notice" to retry.', 'err'); }
      router();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = 'Open for review & notify…'; }
  });
}

/* ---------------- admin: results ---------------- */
let posTab = 'results';
async function positionResults(p) {
  const A = canAdmin();
  const [rows, versions, sends, history] = await Promise.all([
    must(sb.rpc('position_results', { p_position: p.id })),
    must(sb.from('position_versions').select('*').eq('position_id', p.id).order('version', { ascending: false })),
    must(sb.from('campaigns').select('id,name,purpose,status,sent_at,recipient_count').eq('position_id', p.id).order('created_at', { ascending: false })),
    must(sb.from('position_responses').select('*').eq('position_id', p.id).order('responded_at', { ascending: false })),
  ]);
  const n = k => rows.filter(r => r.response === k).length;
  const notNotified = rows.filter(r => !r.notified_at).length;
  const isOpen = p.status === 'open' && new Date(p.closes_at) > new Date();

  const btn = (id, label, cls = 'ghost') => `<button class="btn btn-sm ${cls}" id="${id}" type="button">${label}</button>`;
  const actions = !A ? '' : [
    isOpen && notNotified ? btn('xNotice', `Send notice (${notNotified} not yet emailed)`, 'gold') : '',
    isOpen ? btn('xRemind', 'Send reminder to non-responders') : '',
    isOpen ? btn('xOnBehalf', 'Record a response') : '',
    isOpen ? btn('xEdit', 'Edit text (new version)') : '',
    isOpen ? btn('xClose', 'Close review now') : '',
    p.status === 'closed' ? btn('xFinal', 'Finalise position', 'green') : '',
    ['open', 'closed'].includes(p.status) ? btn('xWithdraw', 'Withdraw', 'danger') : '',
  ].join('');

  amain(`<p class="crumb"><a href="#/admin/positions">← Council positions</a></p>
    <div class="ahead"><div><h1>${esc(p.title)}</h1>
      <p class="small muted">${posBadge(p.status)} · version ${p.version}${p.jurisdiction ? ' · ' + esc(p.jurisdiction) : ''}<br>
      Opened ${fmtDateTime(p.opened_at)} · ${p.status === 'open' ? 'closes' : 'closed'} ${fmtClose(p.closed_at || p.closes_at)}${p.reminder_sent_at ? ' · reminder sent ' + fmtDateTime(p.reminder_sent_at) : ''}${p.finalised_at ? ' · finalised ' + fmtDateTime(p.finalised_at) : ''}</p></div>
      <div class="row">${btn('xCsv', 'Export CSV')}</div></div>
    ${actions ? `<div class="row wrap-row" style="margin-bottom:12px">${actions}</div>` : ''}
    ${p.status === 'final' && p.final_note ? `<p class="notice small"><strong>Final note:</strong> ${esc(p.final_note)}</p>` : ''}
    <div class="kpis">
      <div class="kpi"><strong>${rows.length}</strong><span>Organisations asked</span></div>
      <div class="kpi ${notNotified ? 'alert' : ''}"><strong>${rows.length - notNotified}</strong><span>Notified by email</span></div>
      <div class="kpi"><strong>${n('endorse')}</strong><span>Endorsed</span></div>
      <div class="kpi"><strong>${n('opt_out')}</strong><span>Opted out</span></div>
      <div class="kpi"><strong>${n('no_response')}</strong><span>No endorsement recorded</span></div>
    </div>
    <div class="tabs">${[['results', 'Responses'], ['text', `Position text (${versions.length} version${versions.length === 1 ? '' : 's'})`], ['history', 'Response history'], ['emails', `Emails (${sends.length})`]]
      .map(([k, l]) => `<button type="button" data-ptab="${k}" class="${posTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="ptab"></div>`);

  const tabs = {
    results: () => `<div class="table-wrap"><table class="tbl"><thead><tr><th>Organisation</th><th>Notified</th><th>Response</th><th>On version</th><th>By</th><th>When</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><strong>${esc(r.org_name)}</strong><br><span class="small muted">${esc(r.state || '')}</span></td>
        <td class="small">${r.notified_at ? fmtDateTime(r.notified_at) : '<span class="bad">Not emailed</span>'}${r.reminded_at ? `<br><span class="muted">reminded ${fmtDateTime(r.reminded_at)}</span>` : ''}</td>
        <td>${respBadge(r.response)}${r.comment ? `<br><span class="small">“${esc(r.comment)}”</span>` : ''}</td>
        <td class="small">${r.response_version ? 'v' + r.response_version + (r.response_version !== p.version ? ' <span class="pill-note">earlier text</span>' : '') : ''}</td>
        <td class="small">${esc(r.responder_name || '')}${r.method === 'admin_on_behalf' ? '<br><span class="muted">recorded by Council</span>' : ''}</td>
        <td class="small">${fmtDateTime(r.responded_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No organisations.</td></tr>'}
      </tbody></table></div>`,
    text: () => versions.map(v => `<div class="card"><div class="row between"><h2>Version ${v.version}${v.version === p.version ? ' <span class="tag">current</span>' : ''}${p.final_version === v.version ? ' <span class="tag">final</span>' : ''}</h2><span class="small muted">${fmtDateTime(v.created_at)}</span></div>
      <h3>${esc(v.title)}</h3>${v.summary ? `<p><strong>${esc(v.summary)}</strong></p>` : ''}<div class="prose">${md(v.body)}</div></div>`).join('')
      + (p.document_path ? `<p><button class="linklike" id="xDoc" type="button">📎 ${esc(p.document_name)}</button></p>` : ''),
    history: () => `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>When</th><th>Organisation</th><th>Response</th><th>Version</th><th>By</th></tr></thead><tbody>
      ${history.map(h => `<tr><td class="small">${fmtDateTime(h.responded_at)}</td><td>${esc(rows.find(r => r.org_id === h.org_id)?.org_name || '')}</td><td>${respBadge(h.response)}${h.comment ? `<br><span class="small">“${esc(h.comment)}”</span>` : ''}</td>
        <td class="small">v${h.version}</td><td class="small">${esc(h.responder_name || '')}${h.method === 'admin_on_behalf' ? ' (Council)' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No responses yet.</td></tr>'}
      </tbody></table></div>`,
    emails: () => `<table class="tbl"><tbody>${sends.map(c => `<tr class="click" data-href="#/admin/comms/${c.id}"><td>${esc(c.purpose === 'position_reminder' ? 'Reminder' : 'Review notice')}</td><td>${campaignBadge(c.status)}</td><td class="small">${fmtDateTime(c.sent_at)}</td><td class="num">${fmtNum(c.recipient_count)} people</td></tr>`).join('') || '<tr><td class="muted">No emails sent.</td></tr>'}</tbody></table>`,
  };
  const drawTab = () => { $('#ptab').innerHTML = tabs[posTab](); wireRowLinks($('#ptab')); $('#xDoc')?.addEventListener('click', () => openDocument(p.document_path)); };
  $$('[data-ptab]').forEach(b => b.onclick = () => { posTab = b.dataset.ptab; $$('[data-ptab]').forEach(x => x.classList.toggle('active', x === b)); drawTab(); });
  drawTab();

  $('#xCsv').onclick = () => downloadCsv(rows, [
    { label: 'Organisation', key: 'org_name' }, { label: 'State', key: 'state' },
    { label: 'Notified', get: r => fmtDateTime(r.notified_at) }, { label: 'Reminded', get: r => fmtDateTime(r.reminded_at) },
    { label: 'Response', get: r => RESP_LABELS[r.response] }, { label: 'Comment', key: 'comment' },
    { label: 'Position version responded to', key: 'response_version' }, { label: 'Responded by', key: 'responder_name' },
    { label: 'Method', get: r => (r.method === 'admin_on_behalf' ? 'Recorded by Council' : r.method ? 'Online' : '') },
    { label: 'Responded at', get: r => fmtDateTime(r.responded_at) },
    { label: 'Position', get: () => p.title }, { label: 'Current version', get: () => p.version }, { label: 'Final version', get: () => p.final_version || '' },
  ], `aimoc-position-${slugify(p.title)}-${today()}.csv`);

  const act = (fn, msg) => async e => { const b = e.currentTarget; b.disabled = true; try { await fn(); if (msg) toast(msg); router(); } catch (err) { fail(err); b.disabled = false; } };
  $('#xNotice')?.addEventListener('click', act(async () => { const r = await invokeSend({ position_id: p.id, kind: 'notice' }); toast(`${r.organisations || 0} organisation(s) emailed`); }));
  $('#xRemind')?.addEventListener('click', act(async () => {
    if (!confirm(`Email a reminder now to organisations with no response (${n('no_response')})?`)) throw new Error('Cancelled');
    const r = await invokeSend({ position_id: p.id, kind: 'reminder' });
    toast(r.nothing_to_send ? 'Everyone has responded — nothing to send.' : `Reminder sent to ${r.organisations} organisation(s)`);
  }));
  $('#xClose')?.addEventListener('click', act(async () => { if (!confirm('Close the review now? Organisations will no longer be able to respond.')) throw new Error('Cancelled'); await must(sb.from('council_positions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', p.id)); }, 'Review closed'));
  $('#xWithdraw')?.addEventListener('click', act(async () => { if (!confirm('Withdraw this position? Responses are kept on record.')) throw new Error('Cancelled'); await must(sb.from('council_positions').update({ status: 'withdrawn' }).eq('id', p.id)); }, 'Position withdrawn'));
  $('#xFinal')?.addEventListener('click', () => {
    const m = modal(`<h2>Finalise position</h2><p class="small">This locks version ${p.version} as the final position. Results: <strong>${n('endorse')} endorsed</strong>, ${n('opt_out')} opted out, ${n('no_response')} with no endorsement recorded.</p>
      <form class="form" id="ff">${field('Note (optional)', '<textarea name="note" rows="3" placeholder="e.g. Submitted to the Department on 3 November"></textarea>')}<button class="btn green" type="submit">Finalise</button></form>`);
    $('#ff', m.el).onsubmit = async e => { e.preventDefault(); try { await must(sb.from('council_positions').update({ status: 'final', final_note: e.target.note.value.trim() || null }).eq('id', p.id)); m.close(); toast('Position finalised'); router(); } catch (err) { fail(err); } };
  });
  $('#xEdit')?.addEventListener('click', () => {
    const m = modal(`<h2>Edit position text</h2><p class="notice small">Saving creates <strong>version ${p.version + 1}</strong>. Responses already received stay recorded against the version they saw. Consider sending a notice to explain the change.</p>
      <form class="form" id="ef">${field('Title', `<input name="title" required value="${esc(p.title)}">`)}${field('Summary', `<textarea name="summary" rows="2">${esc(p.summary)}</textarea>`)}${mdField('body', 'Position text', p.body, 16)}
      <button class="btn" type="submit">Save as version ${p.version + 1}</button></form>`, { wide: true });
    wireMd(m.el);
    $('#ef', m.el).onsubmit = async e => { e.preventDefault(); const f = e.target; try { await must(sb.from('council_positions').update({ title: f.title.value.trim(), summary: f.summary.value.trim() || null, body: f.body.value }).eq('id', p.id)); m.close(); toast('New version saved'); router(); } catch (err) { fail(err); } };
  });
  $('#xOnBehalf')?.addEventListener('click', () => {
    const m = modal(`<h2>Record a response</h2><p class="small muted">Use this when an organisation responds by email or phone. It is recorded as "recorded by Council" with your name.</p>
      <form class="form" id="of">${field('Organisation', `<select name="org" required><option value="">Choose…</option>${rows.map(r => opt(r.org_id, `${r.org_name} — ${RESP_LABELS[r.response]}`)).join('')}</select>`)}
      ${field('Response', `<select name="resp" required>${opt('endorse', 'Endorse')}${opt('opt_out', 'Opt out')}${opt('withdrawn', 'Withdraw previous response')}</select>`)}
      ${field('Note', '<textarea name="comment" rows="2" maxlength="2000" placeholder="e.g. Confirmed by email from the President, 15 Oct"></textarea>')}
      <button class="btn" type="submit">Record</button></form>`);
    $('#of', m.el).onsubmit = async e => { e.preventDefault(); const f = e.target; try { await must(sb.rpc('respond_to_position', { p_position: p.id, p_org: f.org.value, p_response: f.resp.value, p_comment: f.comment.value })); m.close(); toast('Response recorded'); router(); } catch (err) { fail(err); } };
  });
}

/* =====================================================================
   MEMBER PORTAL
   ===================================================================== */
async function myRespondableOrgs() {
  if (!S.session) return new Set();
  const { data } = await sb.from('contacts').select('org_id,portal_access,authorised_to_speak,authorised_to_vote').eq('user_id', S.session.user.id).eq('active', true);
  return new Set((data || []).filter(c => c.portal_access === 'org_admin' || c.authorised_to_speak || c.authorised_to_vote).map(c => c.org_id));
}

/** Rendered into #portalPositions on the My account page. */
async function drawPortalPositions() {
  const box = $('#portalPositions'); if (!box || !S.myContacts.length) return;
  const orgIds = uniq(S.myContacts.map(c => c.org_id));
  const { data: rec } = await sb.from('position_recipients').select('position_id,org_id,council_positions(id,title,status,closes_at,version)').in('org_id', orgIds);
  const list = (rec || []).filter(r => r.council_positions && r.council_positions.status !== 'withdrawn');
  if (!list.length) { box.innerHTML = ''; return; }
  const { data: resp } = await sb.from('position_response_current').select('position_id,org_id,response').in('org_id', orgIds);
  const respOf = r => (resp || []).find(x => x.position_id === r.position_id && x.org_id === r.org_id)?.response;
  list.sort((x, y) => (x.council_positions.status === 'open' ? 0 : 1) - (y.council_positions.status === 'open' ? 0 : 1) || String(y.council_positions.closes_at).localeCompare(String(x.council_positions.closes_at)));
  box.innerHTML = `<h2 class="sec">Council positions</h2><div class="table-wrap"><table class="tbl"><tbody>
    ${list.map(r => { const p = r.council_positions, rs = respOf(r); const open = p.status === 'open' && new Date(p.closes_at) > new Date();
      return `<tr class="click" data-href="#/portal/position/${p.id}"><td><strong>${esc(p.title)}</strong><br><span class="small muted">${esc(orgName(S.myContacts.find(c => c.org_id === r.org_id)?.organisations))}</span></td>
        <td>${open ? `<span class="small">Closes ${fmtClose(p.closes_at)}</span>` : posBadge(p.status)}</td>
        <td>${respBadge(rs && rs !== 'withdrawn' ? rs : 'no_response')}</td>
        <td class="num"><a class="btn btn-xs ${open && (!rs || rs === 'withdrawn') ? 'gold' : 'ghost'}" href="#/portal/position/${p.id}">${open ? 'Respond' : 'View'}</a></td></tr>`; }).join('')}
    </tbody></table></div>`;
  $$('tr[data-href]', box).forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a,button')) location.hash = tr.dataset.href; }));
}

route(/^#\/portal\/position\/([0-9a-f-]{36})$/, async id => {
  if (!S.session) { try { localStorage.setItem('aimoc_after_login', location.hash); } catch {} return go('#/login'); }
  await afterLogin();
  const p = (await sb.from('council_positions').select('*').eq('id', id).maybeSingle()).data;
  if (!p) return render(`<section class="wrap narrow page"><h1>Position not available</h1><p class="muted">This position wasn't sent to an organisation you're a contact for, or you're logged in with a different email address.</p><a class="btn" href="#/portal">My account</a></section>`);
  const [rec, resp, can] = await Promise.all([
    must(sb.from('position_recipients').select('org_id,notified_at').eq('position_id', id)),
    must(sb.from('position_response_current').select('*').eq('position_id', id)),
    myRespondableOrgs(),
  ]);
  const myOrgs = rec.filter(r => S.myContacts.some(c => c.org_id === r.org_id));
  const open = p.status === 'open' && new Date(p.closes_at) > new Date();
  const text = p.status === 'final' ? { title: p.final_title, body: p.final_body } : p;

  render(`<section class="page-head slim"><div class="wrap">
      <p class="crumb"><a href="#/portal">← My account</a></p>
      <p class="small">${posBadge(p.status)} ${p.version > 1 ? `<span class="tag soft">version ${p.version}</span>` : ''}</p>
      <h1>${esc(text.title)}</h1>${p.jurisdiction ? `<p class="muted">${esc(p.jurisdiction)}</p>` : ''}</div></section>
    <section class="wrap page">
      <div class="split" style="grid-template-columns:1.5fr 1fr;align-items:start">
        <div class="card">
          ${p.summary && p.status !== 'final' ? `<p><strong>${esc(p.summary)}</strong></p>` : ''}
          <div class="prose">${md(text.body)}</div>
          ${p.document_path ? `<p><button class="btn btn-sm ghost" id="pdoc" type="button">📎 ${esc(p.document_name)}</button></p>` : ''}
        </div>
        <div>
          <div class="card">
            <h2>${open ? 'Your response' : 'Review period'}</h2>
            <p class="small">${open ? 'Review closes' : 'Review closed'} <strong>${fmtClose(p.closed_at || p.closes_at)}</strong></p>
            <p class="notice small">If your organisation doesn't respond, <strong>no endorsement is recorded</strong>. Silence is not treated as endorsement.</p>
          </div>
          ${myOrgs.map(r => {
            const cur = resp.find(x => x.org_id === r.org_id);
            const state = cur && cur.response !== 'withdrawn' ? cur.response : 'no_response';
            const mayAnswer = open && can.has(r.org_id);
            const org = S.myContacts.find(c => c.org_id === r.org_id)?.organisations;
            return `<div class="card form" data-org="${r.org_id}">
              <h3>${esc(orgName(org))}</h3>
              <p>${respBadge(state)}${cur && cur.response !== 'withdrawn' ? `<br><span class="small muted">by ${esc(cur.responder_name || '')} · ${fmtDateTime(cur.responded_at)} · on version ${cur.version}${cur.version !== p.version ? ' (the text has since been updated — please review)' : ''}</span>` : ''}</p>
              ${cur?.comment && cur.response !== 'withdrawn' ? `<p class="small">“${esc(cur.comment)}”</p>` : ''}
              ${mayAnswer ? `
                <fieldset><legend class="sr-only">Response</legend>
                  <label class="check"><input type="radio" name="r_${r.org_id}" value="endorse" ${state === 'endorse' ? 'checked' : ''}> <span><strong>Endorse</strong> — ${esc(orgName(org))} may be listed as supporting this position</span></label>
                  <label class="check"><input type="radio" name="r_${r.org_id}" value="opt_out" ${state === 'opt_out' ? 'checked' : ''}> <span><strong>Opt out</strong> — do not list ${esc(orgName(org))} as supporting it</span></label>
                </fieldset>
                ${field('Comment (optional)', `<textarea name="c_${r.org_id}" rows="2" maxlength="2000"></textarea>`)}
                <div class="row"><button class="btn gold" data-submit="${r.org_id}" type="button">${state === 'no_response' ? 'Submit response' : 'Update response'}</button>
                ${state !== 'no_response' ? `<button class="btn ghost" data-withdraw="${r.org_id}" type="button">Withdraw response</button>` : ''}</div>`
              : open ? `<p class="small muted">Only your organisation's administrator or an authorised representative can respond. Ask them to log in, or <a href="#/contact">contact the Council</a>.</p>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    </section>`);
  $('#pdoc')?.addEventListener('click', () => openDocument(p.document_path));
  const send = async (orgId, response, comment) => {
    const { error } = await sb.rpc('respond_to_position', { p_position: id, p_org: orgId, p_response: response, p_comment: comment || null });
    if (error) return fail(error);
    toast(response === 'endorse' ? 'Endorsement recorded — thank you' : response === 'opt_out' ? 'Opt-out recorded' : 'Response withdrawn');
    router();
  };
  $$('[data-submit]').forEach(b => b.onclick = () => {
    const o = b.dataset.submit, v = $(`input[name="r_${o}"]:checked`)?.value;
    if (!v) return toast('Choose Endorse or Opt out.', 'err');
    if (!confirm(v === 'endorse' ? 'Confirm: your organisation ENDORSES this position?' : 'Confirm: your organisation OPTS OUT of this position?')) return;
    b.disabled = true; send(o, v, $(`textarea[name="c_${o}"]`).value.trim());
  });
  $$('[data-withdraw]').forEach(b => b.onclick = () => { if (confirm('Withdraw your response? Your organisation will show as "No endorsement recorded".')) { b.disabled = true; send(b.dataset.withdraw, 'withdrawn'); } });
});
