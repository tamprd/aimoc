/* =====================================================================
   AIMOC platform — register.js
   Organisation registration wizard (Sections A–F) + member portal
   ===================================================================== */

const REG_STEPS = ['Organisation', 'Categories & disciplines', 'Size & representation', 'Contacts', 'Permissions', 'Review & submit'];
let R = null;           // registration draft
let regStep = 0;

const regKey = () => `aimoc_reg_${S.session?.user?.id}`;
const saveDraft = () => { try { localStorage.setItem(regKey(), JSON.stringify({ R, regStep })); } catch {} };
const clearDraft = () => { try { localStorage.removeItem(regKey()); } catch {} };
function newDraft() {
  return {
    org: { legal_name: '', trading_name: '', abn_acn: '', website: '', postal_address: '', state: '', operating_states: [], operating_regions: '', year_established: '', description: '', category_other: '', discipline_other: '', affiliated_with: '' },
    logo_path: '', category_ids: [], discipline_ids: [],
    stats: { period_label: '', period_start: '', period_end: '', includes_affiliates: false, source_note: '', values: {} },
    lead: { full_name: '', position_title: '', phone: '', preferred_contact: 'email', role_ids: [], role_other: '', authorised_to_speak: true, authorised_to_vote: false, receive_council_comms: true },
    contacts: [], consents: {},
  };
}

route(/^#\/join$/, async () => {
  if (!S.session) {
    return render(`<section class="page-head"><div class="wrap"><h1>Join AIMOC</h1>
      <p class="lead">Register your organisation with the Australian Independent Motorsport Operators Council.</p></div></section>
      <section class="wrap page split">
        <div>
          <h2 class="sec">Before you start</h2>
          <ul class="ticks">
            <li>Registration is for <strong>organisations</strong> — clubs, sanctioning bodies, associations, venues, promoters and organisers.</li>
            <li>You'll be the organisation's <strong>lead contact</strong>. You can add other representatives.</li>
            <li>Have your best available <strong>participation figures</strong> handy. Estimates are fine — you'll mark them as estimates.</li>
            <li>You decide, separately, how AIMOC may use your information.</li>
            <li>Takes about 10–15 minutes. Your progress is saved on this device.</li>
          </ul>
        </div>
        <div>
          <h2 class="sec">Step 1 — verify your email</h2>
          <p class="muted small">Use the email address you want AIMOC to contact you on as lead contact.</p>
          ${linkFormHtml({ button: 'Send verification link' })}
        </div>
      </section>`), wireLinkForm('linkForm', 'join');
  }
  await loadLookups();
  try { const saved = JSON.parse(localStorage.getItem(regKey()) || 'null'); if (saved?.R) { R = saved.R; regStep = saved.regStep || 0; } } catch {}
  if (!R) { R = newDraft(); regStep = 0; }
  drawWizard();
});

function drawWizard() {
  render(`<section class="page-head slim"><div class="wrap"><h1>Register your organisation</h1>
      <p class="muted">Logged in as <strong>${esc(S.session.user.email)}</strong> — you'll be the lead contact.</p></div></section>
    <section class="wrap page wizard">
      <ol class="steps">${REG_STEPS.map((s, i) => `<li class="${i === regStep ? 'cur' : i < regStep ? 'done' : ''}"><span>${i + 1}</span>${esc(s)}</li>`).join('')}</ol>
      <form id="wiz" class="card form" novalidate>${stepHtml()}</form>
      <div class="wiz-nav">
        ${regStep > 0 ? '<button class="btn ghost" type="button" id="wBack">← Back</button>' : '<span></span>'}
        <div class="row">
          <button class="linklike small" type="button" id="wReset">Start again</button>
          ${regStep < REG_STEPS.length - 1 ? '<button class="btn" type="button" id="wNext">Continue →</button>' : '<button class="btn gold" type="button" id="wSubmit">Submit registration</button>'}
        </div>
      </div>
    </section>`);
  wireStep();
  $('#wBack')?.addEventListener('click', () => { collectStep(); regStep--; saveDraft(); drawWizard(); window.scrollTo(0, 0); });
  $('#wNext')?.addEventListener('click', () => {
    collectStep();
    const problem = validateStep();
    if (problem) return showWizError(problem);
    regStep++; saveDraft(); drawWizard(); window.scrollTo(0, 0);
  });
  $('#wSubmit')?.addEventListener('click', submitRegistration);
  $('#wReset').onclick = () => { if (confirm('Clear everything you have entered and start again?')) { R = newDraft(); regStep = 0; clearDraft(); drawWizard(); } };
}
function showWizError(msg) {
  $('#wiz .form-error')?.remove();
  $('#wiz').insertAdjacentHTML('afterbegin', `<p class="form-error" role="alert">${esc(msg)}</p>`);
  $('#wiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- step templates ---------- */
function stepHtml() {
  const o = R.org;
  switch (regStep) {
    case 0: return `
      <h2>A. Organisation details</h2>
      <div class="grid2">
        ${field('Full registered organisation name *', `<input name="legal_name" required value="${esc(o.legal_name)}">`)}
        ${field('Trading name (if different)', `<input name="trading_name" value="${esc(o.trading_name)}">`)}
        ${field('ABN or ACN (if applicable)', `<input name="abn_acn" inputmode="numeric" value="${esc(o.abn_acn)}">`)}
        ${field('Website', `<input name="website" type="url" placeholder="https://" value="${esc(o.website)}">`)}
        ${field('State or territory (head office) *', `<select name="state" required><option value="">Choose…</option>${STATES.map(s => opt(s, STATE_NAMES[s], o.state)).join('')}</select>`)}
        ${field('Year established', `<input name="year_established" type="number" min="1850" max="2100" value="${esc(o.year_established)}">`)}
      </div>
      ${field('Postal address', `<textarea name="postal_address" rows="2">${esc(o.postal_address)}</textarea>`)}
      <fieldset><legend>States &amp; territories you operate in</legend>
        <div class="check-grid">${[...STATES, 'National'].map(s => chk('operating_states', s, o.operating_states.includes(s), s === 'National' ? 'National' : s)).join('')}</div></fieldset>
      ${field('Geographic operating regions', `<input name="operating_regions" placeholder="e.g. South East Queensland, Darling Downs" value="${esc(o.operating_regions)}">`)}
      ${field('Short description of your organisation', `<textarea name="description" rows="3" maxlength="800">${esc(o.description)}</textarea>`, 'Up to 800 characters. May appear in the public directory if you give permission.')}
      <div class="field"><span class="lbl">Organisation logo (optional)</span>
        <div class="logo-up">${R.logo_path ? `<img src="${esc(logoUrl(R.logo_path))}" alt="Logo preview">` : '<div class="logo-ph">Logo</div>'}
        <input type="file" id="logoFile" accept="image/png,image/jpeg,image/svg+xml,image/webp"></div>
        <small class="hint">PNG, JPG, SVG or WebP, up to 2 MB.</small></div>`;

    case 1: return `
      <h2>Organisation category</h2>
      <p class="muted small">Choose every category that applies.</p>
      <div class="check-grid">${activeList(S.L.categories).map(c => chk('category_ids', c.id, R.category_ids.includes(String(c.id)), esc(c.name))).join('')}</div>
      ${field('Other category', `<input name="category_other" value="${esc(o.category_other)}">`)}
      <h2>B. Motorsport disciplines</h2>
      <p class="muted small">Choose every discipline your organisation is involved in.</p>
      <div class="check-grid">${activeList(S.L.disciplines).map(d => chk('discipline_ids', d.id, R.discipline_ids.includes(String(d.id)), esc(d.name))).join('')}</div>
      ${field('Other discipline', `<input name="discipline_other" value="${esc(o.discipline_other)}">`)}`;

    case 2: {
      const st = R.stats;
      return `
      <h2>C. Organisation size &amp; representation</h2>
      <div class="explainer">
        <p><strong>This is the most important part of registration.</strong> These figures let the Council show government the real scale of independent motorsport.</p>
        <ul>
          <li><strong>People</strong> fields count each person once (members, licence holders, unique participants, volunteers).</li>
          <li><strong>Entries</strong> and <strong>attendance</strong> count activity — one person entering ten events is ten entries.</li>
          <li>Not sure? Give your best estimate and mark it <em>Estimate</em>. Or choose Unknown, Not applicable or Prefer not to disclose.</li>
          <li>AIMOC never simply adds everyone's figures together — people often belong to more than one organisation.</li>
        </ul>
      </div>
      <div class="grid3">
        ${field('Reporting period *', `<input name="period_label" list="periods" placeholder="e.g. 2025 calendar year" value="${esc(st.period_label)}">
          <datalist id="periods"><option value="2025 calendar year"><option value="2026 calendar year"><option value="FY 2024–25"><option value="FY 2025–26"><option value="2025–26 season"></datalist>`)}
        ${field('Period start', `<input name="period_start" type="date" value="${esc(st.period_start)}">`)}
        ${field('Period end', `<input name="period_end" type="date" value="${esc(st.period_end)}">`)}
      </div>
      <div class="metric-table" role="table">
        <div class="mt-head" role="row"><span>Measure</span><span>Answer</span><span>Number</span><span>Accuracy</span><span>Notes</span></div>
        ${activeList(S.L.metrics).map(m => {
          const v = st.values[m.key] || {};
          return `<div class="mt-row" role="row" data-key="${esc(m.key)}">
            <div><strong>${esc(m.label)}</strong><small class="hint">${esc(m.description || '')}</small><span class="kind kind-${m.kind}">${m.kind === 'people' ? 'unique people' : m.kind}</span></div>
            <select name="ans_${m.key}" aria-label="${esc(m.label)} answer"><option value="">— choose —</option>${Object.entries(ANSWERS).map(([k, l]) => opt(k, l, v.answer)).join('')}</select>
            <input name="val_${m.key}" type="number" min="0" step="1" inputmode="numeric" aria-label="${esc(m.label)} number" value="${esc(v.value ?? '')}" ${v.answer && v.answer !== 'reported' ? 'disabled' : ''}>
            <select name="pre_${m.key}" aria-label="${esc(m.label)} accuracy" ${v.answer && v.answer !== 'reported' ? 'disabled' : ''}>${opt('estimate', 'Estimate', v.precision || 'estimate')}${opt('exact', 'Exact', v.precision)}</select>
            <input name="note_${m.key}" aria-label="${esc(m.label)} notes" placeholder="optional" value="${esc(v.notes || '')}">
          </div>`;
        }).join('')}
      </div>
      ${chk('includes_affiliates', '1', st.includes_affiliates, 'Our people figures <strong>include</strong> people who belong to our affiliated clubs')}
      ${field('Is your organisation affiliated with, or sanctioned by, another body?', `<input name="affiliated_with" placeholder="Name the body/bodies, or leave blank" value="${esc(o.affiliated_with)}">`, 'Helps the Council avoid counting the same people twice.')}
      ${field('How were these figures worked out?', `<textarea name="source_note" rows="2" placeholder="e.g. Membership database export 30 June; entries from event results">${esc(st.source_note)}</textarea>`)}`;
    }

    case 3: {
      const l = R.lead;
      const roleChecks = (name, sel) => activeList(S.L.roles).map(r => chk(name, r.id, (sel || []).map(String).includes(String(r.id)), esc(r.name))).join('');
      return `
      <h2>D. Lead contact</h2>
      <p class="muted small">The principal authorised contact can maintain the organisation's profile and contacts.</p>
      <div class="grid2">
        ${field('Full name *', `<input name="l_full_name" required autocomplete="name" value="${esc(l.full_name)}">`)}
        ${field('Position or title', `<input name="l_position_title" value="${esc(l.position_title)}">`)}
        ${field('Email', `<input value="${esc(S.session.user.email)}" disabled>`, 'Verified login email')}
        ${field('Telephone / mobile', `<input name="l_phone" type="tel" autocomplete="tel" value="${esc(l.phone)}">`)}
        ${field('Preferred contact method', `<select name="l_preferred_contact">${opt('email', 'Email', l.preferred_contact)}${opt('phone', 'Phone', l.preferred_contact)}${opt('sms', 'SMS', l.preferred_contact)}</select>`)}
      </div>
      <fieldset><legend>Role(s)</legend><div class="check-grid">${roleChecks('l_role_ids', l.role_ids)}</div></fieldset>
      <div class="stack">
        ${chk('l_authorised_to_speak', '1', l.authorised_to_speak, 'Authorised to <strong>speak</strong> on behalf of the organisation')}
        ${chk('l_authorised_to_vote', '1', l.authorised_to_vote, 'Authorised to <strong>vote</strong> on behalf of the organisation')}
        ${chk('l_receive_council_comms', '1', l.receive_council_comms, 'Receive Council-wide communications')}
      </div>
      <h2>E. Additional contacts</h2>
      <p class="muted small">Add other representatives — e.g. Secretary, CEO, venue manager, media. Each manages their own email preferences.</p>
      <div id="xContacts">${R.contacts.map((c, i) => contactCard(c, i)).join('')}</div>
      <button class="btn ghost" type="button" id="addContact">+ Add a contact</button>`;
    }

    case 4: return `
      <h2>F. Data sharing &amp; permissions</h2>
      <p>Each permission is recorded separately, with today's date and the wording version (v${esc(S.settings.consent_version)}). You can change these later.
      <strong>Joining does not by itself allow AIMOC to publish your statistics or contact details.</strong></p>
      <div class="consents">${currentStatements().map(c => `
        <label class="consent"><input type="checkbox" name="consent_${esc(c.key)}" ${R.consents[c.key] ? 'checked' : ''}>
          <span><strong>${esc(c.label)}</strong><br><span class="small">${esc(c.statement)}</span></span></label>`).join('')}
      </div>`;

    case 5: return reviewHtml();
  }
  return '';
}

function contactCard(c, i) {
  const discs = R.discipline_ids.length ? activeList(S.L.disciplines).filter(d => R.discipline_ids.includes(String(d.id))) : activeList(S.L.disciplines);
  return `<div class="card sub contact-card" data-i="${i}">
    <div class="row between"><strong>Contact ${i + 1}</strong><button class="linklike small bad" type="button" data-remove="${i}">Remove</button></div>
    <div class="grid2">
      ${field('Full name *', `<input name="c_full_name" value="${esc(c.full_name)}">`)}
      ${field('Email *', `<input name="c_email" type="email" value="${esc(c.email)}">`)}
      ${field('Position or title', `<input name="c_position_title" value="${esc(c.position_title)}">`)}
      ${field('Telephone / mobile', `<input name="c_phone" type="tel" value="${esc(c.phone)}">`)}
      ${field('Preferred contact', `<select name="c_preferred_contact">${opt('email', 'Email', c.preferred_contact)}${opt('phone', 'Phone', c.preferred_contact)}${opt('sms', 'SMS', c.preferred_contact)}</select>`)}
      ${field('Portal access', `<select name="c_portal_access">${opt('org_rep', 'Representative (view & participate)', c.portal_access || 'org_rep')}${opt('org_admin', 'Administrator (can edit profile)', c.portal_access)}${opt('none', 'No portal access', c.portal_access)}</select>`)}
    </div>
    <details><summary>Roles</summary><div class="check-grid">${activeList(S.L.roles).map(r => chk(`c_role_${i}`, r.id, (c.role_ids || []).map(String).includes(String(r.id)), esc(r.name))).join('')}</div></details>
    <details><summary>Discipline subscriptions <span class="hint">(leave all unticked to receive everything)</span></summary>
      <div class="check-grid">${discs.map(d => chk(`c_disc_${i}`, d.id, (c.discipline_ids || []).map(String).includes(String(d.id)), esc(d.name))).join('')}</div></details>
    <div class="stack">
      ${chk('c_receive_council_comms', '1', c.receive_council_comms !== false, 'Receive Council-wide communications')}
      ${chk('c_authorised_to_speak', '1', c.authorised_to_speak, 'Authorised to speak on behalf of the organisation')}
    </div>
  </div>`;
}

function reviewHtml() {
  const o = R.org, st = R.stats;
  const names = (list, ids) => ids.map(id => nameOf(list, id)).filter(Boolean).join(', ') || '—';
  const vals = activeList(S.L.metrics).map(m => {
    const v = st.values[m.key];
    const shown = !v?.answer ? '<span class="bad">Not answered</span>' : v.answer === 'reported' ? `${fmtNum(v.value)} <span class="muted small">(${v.precision})</span>` : esc(ANSWERS[v.answer]);
    return `<tr><td>${esc(m.label)}</td><td>${shown}</td></tr>`;
  }).join('');
  const unanswered = activeList(S.L.metrics).filter(m => !st.values[m.key]?.answer).length;
  return `<h2>Review &amp; submit</h2>
    <div class="review">
      <section><h3>Organisation <button class="linklike small" type="button" data-goto="0">Edit</button></h3>
        <p><strong>${esc(o.legal_name)}</strong>${o.trading_name ? ` (trading as ${esc(o.trading_name)})` : ''}<br>
        ${esc(o.state)}${o.operating_states.length ? ' · operates in ' + esc(o.operating_states.join(', ')) : ''}${o.abn_acn ? '<br>ABN/ACN ' + esc(o.abn_acn) : ''}</p></section>
      <section><h3>Categories &amp; disciplines <button class="linklike small" type="button" data-goto="1">Edit</button></h3>
        <p>${esc(names(S.L.categories, R.category_ids))}${o.category_other ? ', ' + esc(o.category_other) : ''}<br>
        <span class="muted">${esc(names(S.L.disciplines, R.discipline_ids))}${o.discipline_other ? ', ' + esc(o.discipline_other) : ''}</span></p></section>
      <section><h3>Statistics — ${esc(st.period_label || 'no period')} <button class="linklike small" type="button" data-goto="2">Edit</button></h3>
        ${unanswered ? `<p class="notice small">${unanswered} measure${unanswered > 1 ? 's' : ''} not answered. You can still submit, but complete answers make the Council's case stronger.</p>` : ''}
        <table class="tbl compact">${vals}</table></section>
      <section><h3>Contacts <button class="linklike small" type="button" data-goto="3">Edit</button></h3>
        <p><strong>${esc(R.lead.full_name)}</strong> — lead contact (${esc(S.session.user.email)})<br>
        ${R.contacts.filter(c => c.full_name).map(c => `${esc(c.full_name)} — ${esc(c.email)}`).join('<br>') || '<span class="muted">No additional contacts</span>'}</p></section>
      <section><h3>Permissions <button class="linklike small" type="button" data-goto="4">Edit</button></h3>
        <ul class="perm-list">${currentStatements().map(c => `<li class="${R.consents[c.key] ? 'yes' : 'no'}">${R.consents[c.key] ? '✓' : '✗'} ${esc(c.label)}</li>`).join('')}</ul></section>
    </div>
    ${chk('declare', '1', false, 'I am authorised to register this organisation, and the information provided is accurate to the best of my knowledge.')}`;
}

/* ---------- step wiring / collection / validation ---------- */
function wireStep() {
  const f = $('#wiz');
  if (regStep === 0) {
    $('#logoFile').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) return toast('Logo must be under 2 MB.', 'err');
      try { collectStep(); R.logo_path = await uploadFile('org-logos', file, S.session.user.id); saveDraft(); drawWizard(); toast('Logo uploaded'); }
      catch (err) { fail(err); }
    };
  }
  if (regStep === 2) {
    f.addEventListener('change', e => {
      if (!e.target.name?.startsWith('ans_')) return;
      const k = e.target.name.slice(4), rep = e.target.value === 'reported' || e.target.value === '';
      f.elements['val_' + k].disabled = !rep; f.elements['pre_' + k].disabled = !rep;
      if (e.target.value === 'reported') f.elements['val_' + k].focus();
    });
    f.addEventListener('input', e => {
      if (!e.target.name?.startsWith('val_')) return;
      const k = e.target.name.slice(4), a = f.elements['ans_' + k];
      if (e.target.value !== '' && !a.value) a.value = 'reported';
    });
  }
  if (regStep === 3) {
    $('#addContact').onclick = () => { collectStep(); R.contacts.push({ preferred_contact: 'email', portal_access: 'org_rep', receive_council_comms: true }); drawWizard(); $$('.contact-card').pop()?.scrollIntoView({ behavior: 'smooth' }); };
    f.addEventListener('click', e => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      collectStep(); R.contacts.splice(+b.dataset.remove, 1); drawWizard();
    });
  }
  if (regStep === 5) {
    f.addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) { regStep = +b.dataset.goto; saveDraft(); drawWizard(); } });
  }
}

function collectStep() {
  const f = $('#wiz'); if (!f) return;
  const val = n => (f.elements[n]?.value ?? '').trim();
  const on = n => !!f.elements[n]?.checked;
  const o = R.org;
  switch (regStep) {
    case 0:
      Object.assign(o, { legal_name: val('legal_name'), trading_name: val('trading_name'), abn_acn: val('abn_acn'), website: val('website'), postal_address: val('postal_address'), state: val('state'), operating_regions: val('operating_regions'), year_established: val('year_established'), description: val('description') });
      o.operating_states = checkedValues(f, 'operating_states');
      break;
    case 1:
      R.category_ids = checkedValues(f, 'category_ids'); R.discipline_ids = checkedValues(f, 'discipline_ids');
      o.category_other = val('category_other'); o.discipline_other = val('discipline_other');
      break;
    case 2: {
      const st = R.stats;
      Object.assign(st, { period_label: val('period_label'), period_start: val('period_start'), period_end: val('period_end'), source_note: val('source_note'), includes_affiliates: on('includes_affiliates') });
      o.affiliated_with = val('affiliated_with');
      activeList(S.L.metrics).forEach(m => {
        const answer = val('ans_' + m.key);
        st.values[m.key] = { answer, value: answer === 'reported' ? val('val_' + m.key) : '', precision: val('pre_' + m.key) || 'estimate', notes: val('note_' + m.key) };
      });
      break;
    }
    case 3:
      Object.assign(R.lead, { full_name: val('l_full_name'), position_title: val('l_position_title'), phone: val('l_phone'), preferred_contact: val('l_preferred_contact'), authorised_to_speak: on('l_authorised_to_speak'), authorised_to_vote: on('l_authorised_to_vote'), receive_council_comms: on('l_receive_council_comms') });
      R.lead.role_ids = checkedValues(f, 'l_role_ids');
      R.contacts = $$('.contact-card', f).map(card => {
        const i = card.dataset.i, g = n => ($(`[name="${n}"]`, card)?.value || '').trim();
        return { full_name: g('c_full_name'), email: g('c_email').toLowerCase(), position_title: g('c_position_title'), phone: g('c_phone'), preferred_contact: g('c_preferred_contact'), portal_access: g('c_portal_access'), receive_council_comms: $('[name="c_receive_council_comms"]', card).checked, authorised_to_speak: $('[name="c_authorised_to_speak"]', card).checked, role_ids: checkedValues(card, `c_role_${i}`), discipline_ids: checkedValues(card, `c_disc_${i}`) };
      });
      break;
    case 4:
      S.L.consentTypes.forEach(c => { R.consents[c.key] = on('consent_' + c.key); });
      break;
  }
}

function validateStep() {
  const o = R.org;
  if (regStep === 0) {
    if (o.legal_name.length < 2) return 'Enter the full registered organisation name.';
    if (!o.state) return 'Choose the state or territory of your head office.';
    if (o.website && !/^https?:\/\/\S+\.\S+/.test(o.website)) return 'Website should start with https://';
    if (o.year_established && (o.year_established < 1850 || o.year_established > new Date().getFullYear())) return 'Check the year established.';
  }
  if (regStep === 1 && !R.category_ids.length && !o.category_other) return 'Choose at least one organisation category.';
  if (regStep === 2) {
    const v = R.stats.values;
    const answered = Object.values(v).filter(x => x.answer);
    if (answered.length && !R.stats.period_label) return 'Enter the reporting period these figures cover.';
    const missing = activeList(S.L.metrics).find(m => v[m.key]?.answer === 'reported' && (v[m.key].value === '' || +v[m.key].value < 0));
    if (missing) return `Enter a number for "${missing.label}", or choose a different answer.`;
    if (R.stats.period_start && R.stats.period_end && R.stats.period_end < R.stats.period_start) return 'Period end is before period start.';
  }
  if (regStep === 3) {
    if (!R.lead.full_name) return 'Enter the lead contact\'s full name.';
    const me = S.session.user.email.toLowerCase();
    const emails = new Set([me]);
    for (const [i, c] of R.contacts.entries()) {
      if (!c.full_name && !c.email) continue;
      if (!c.full_name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return `Contact ${i + 1}: enter a name and a valid email (or remove it).`;
      if (emails.has(c.email)) return `Contact ${i + 1}: ${c.email} is already listed.`;
      emails.add(c.email);
    }
  }
  return null;
}

async function submitRegistration() {
  if (!$('[name="declare"]').checked) return showWizError('Please confirm the declaration before submitting.');
  const btn = $('#wSubmit'); btn.disabled = true; btn.textContent = 'Submitting…';
  const st = R.stats;
  const values = {};
  Object.entries(st.values).forEach(([k, v]) => { if (v.answer) values[k] = v; });
  const payload = {
    org: R.org, category_ids: R.category_ids, discipline_ids: R.discipline_ids, logo_path: R.logo_path,
    lead: R.lead, contacts: R.contacts.filter(c => c.full_name && c.email), consents: R.consents,
    stats: Object.keys(values).length ? { ...st, values } : null,
  };
  const { error } = await sb.rpc('register_organisation', { p: payload });
  if (error) { btn.disabled = false; btn.textContent = 'Submit registration'; return showWizError(errMsg(error)); }
  clearDraft(); R = null; regStep = 0;
  await afterLogin();
  render(`<section class="wrap narrow page"><div class="card sent">
    <div class="sent-icon">✓</div><h1>Registration received</h1>
    <p>Thank you. <strong>${esc(payload.org.legal_name)}</strong> has been submitted to the Council for approval.</p>
    <p class="muted">You'll receive an email once it's approved. Your permissions were recorded against consent wording v${esc(S.settings.consent_version)}.</p>
    <div class="row center"><a class="btn" href="#/portal">Go to my account</a><a class="btn ghost" href="#/">Home</a></div>
  </div></section>`);
}

/* =====================================================================
   MEMBER PORTAL (Phase 1: status, view, permissions, my email prefs)
   ===================================================================== */
const statusBadge = s => `<span class="badge st-${esc(s)}">${esc({ pending: 'Pending approval', approved: 'Approved', rejected: 'Not approved', inactive: 'Inactive' }[s] || s)}</span>`;

route(/^#\/portal$/, async () => {
  if (!S.session) return go('#/login');
  await afterLogin();
  const mine = S.myContacts;
  render(`<section class="page-head slim"><div class="wrap"><h1>My account</h1>
      <p class="muted">Logged in as <strong>${esc(S.session.user.email)}</strong></p></div></section>
    <section class="wrap page">
      ${isStaffUser() ? `<p class="notice">You have Council staff access (${esc(ROLE_LABELS[S.staff.role])}). <a href="#/admin">Open the admin dashboard →</a></p>` : ''}
      <h2 class="sec">My organisations</h2>
      ${mine.length ? `<div class="cards">${mine.map(c => `
        <div class="card org-tile">
          <div class="row between"><h3>${esc(orgName(c.organisations))}</h3>${statusBadge(c.organisations?.status)}</div>
          <p class="small muted">${c.is_principal ? 'Lead contact · ' : ''}${esc(ROLE_LABELS[c.portal_access])}</p>
          <label class="check small"><input type="checkbox" data-pref="${c.id}" ${c.receive_council_comms ? 'checked' : ''}> Email me Council communications</label>
          ${c.portal_access !== 'none' ? `<a class="btn btn-sm ghost" href="#/portal/org/${c.org_id}">View organisation</a>` : ''}
        </div>`).join('')}</div>`
      : `<div class="card"><p>Your login isn't linked to a registered organisation yet.</p>
         <p class="muted small">If someone registered your organisation and listed you as a contact, make sure you logged in with that same email address.</p>
         <a class="btn" href="#/join">Register an organisation</a></div>`}
      ${mine.length ? '<p><a href="#/join">+ Register another organisation</a></p>' : ''}
      <div id="portalPositions"></div>
      <p><button class="btn ghost" id="logout" type="button">Log out</button></p>
    </section>`);
  $('#logout').onclick = signOut;
  drawPortalPositions().catch(console.error);
  $$('[data-pref]').forEach(cb => cb.onchange = async () => {
    const { error } = await sb.from('contacts').update({ receive_council_comms: cb.checked }).eq('id', cb.dataset.pref);
    if (error) { cb.checked = !cb.checked; return fail(error); }
    toast(cb.checked ? 'You will receive Council emails' : 'Unsubscribed from Council emails');
  });
});

route(/^#\/portal\/org\/([0-9a-f-]{36})$/, async id => {
  if (!S.session) return go('#/login');
  await loadLookups();
  const [org, cats, discs, contacts, subs, consents] = await Promise.all([
    sb.from('organisations').select('*').eq('id', id).maybeSingle(),
    sb.from('organisation_categories').select('category_id').eq('org_id', id),
    sb.from('organisation_disciplines').select('discipline_id').eq('org_id', id),
    sb.from('contacts').select('id,full_name,position_title,email,is_principal,portal_access,contact_role_links(role_id)').eq('org_id', id).eq('active', true).order('is_principal', { ascending: false }),
    sb.from('stat_submissions').select('*,stat_values(*)').eq('org_id', id).eq('is_current', true).maybeSingle(),
    sb.from('organisation_consent_current').select('*').eq('org_id', id),
  ]);
  const o = org.data;
  if (!o) return notFound();
  const amAdmin = S.myContacts.some(c => c.org_id === id && c.portal_access === 'org_admin');
  const sub = subs.data;
  const cc = Object.fromEntries((consents.data || []).map(c => [c.consent_key, c]));
  render(`<section class="page-head slim"><div class="wrap">
      <p class="crumb"><a href="#/portal">← My account</a></p>
      <div class="row between"><h1>${esc(orgName(o))}</h1>${statusBadge(o.status)}</div></div></section>
    <section class="wrap page">
      <p class="notice small">Self-service editing of details, contacts and statistics is coming in the next release. To update anything now, <a href="#/contact">contact the Council</a>.</p>
      <div class="split">
        <div class="card"><h2>Details</h2>
          <dl class="dl">
            <dt>Registered name</dt><dd>${esc(o.legal_name)}</dd>
            ${o.trading_name ? `<dt>Trading name</dt><dd>${esc(o.trading_name)}</dd>` : ''}
            ${o.abn_acn ? `<dt>ABN/ACN</dt><dd>${esc(o.abn_acn)}</dd>` : ''}
            <dt>State</dt><dd>${esc(o.state || '—')}${o.operating_states?.length ? ' · operates in ' + esc(o.operating_states.join(', ')) : ''}</dd>
            <dt>Categories</dt><dd>${esc((cats.data || []).map(c => nameOf(S.L.categories, c.category_id)).join(', ') || '—')}</dd>
            <dt>Disciplines</dt><dd>${esc((discs.data || []).map(d => nameOf(S.L.disciplines, d.discipline_id)).join(', ') || '—')}</dd>
            ${o.website ? `<dt>Website</dt><dd>${esc(o.website)}</dd>` : ''}
          </dl></div>
        <div class="card"><h2>Contacts</h2>
          <ul class="plain">${(contacts.data || []).map(c => `<li><strong>${esc(c.full_name)}</strong>${c.is_principal ? ' <span class="tag">Lead</span>' : ''}<br>
            <span class="small muted">${esc([c.position_title, ...(c.contact_role_links || []).map(r => nameOf(S.L.roles, r.role_id))].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul></div>
      </div>
      <div class="card"><h2>Statistics ${sub ? `<span class="muted small">— ${esc(sub.period_label)}${sub.verified_at ? ' · verified by the Council' : ''}</span>` : ''}</h2>
        ${sub ? `<table class="tbl"><thead><tr><th>Measure</th><th>Figure</th><th>Accuracy</th></tr></thead><tbody>
          ${activeList(S.L.metrics).map(m => { const v = (sub.stat_values || []).find(x => x.metric_key === m.key);
            return `<tr><td>${esc(m.label)}</td><td>${!v ? '<span class="muted">—</span>' : v.answer === 'reported' ? fmtNum(v.value) : esc(ANSWERS[v.answer])}</td><td>${v?.precision || ''}</td></tr>`; }).join('')}
          </tbody></table><p class="small muted">Last updated ${fmtDate(sub.updated_at)}</p>` : '<p class="muted">No statistics on file.</p>'}
      </div>
      <div class="card"><h2>Data sharing &amp; permissions</h2>
        ${amAdmin ? '<p class="small muted">As an organisation administrator you can change these. Each change is recorded with the date and wording version.</p>' : ''}
        <div class="consents">${currentStatements().map(c => {
          const cur = cc[c.key];
          return `<label class="consent"><input type="checkbox" data-consent="${esc(c.key)}" ${cur?.granted ? 'checked' : ''} ${amAdmin ? '' : 'disabled'}>
            <span><strong>${esc(c.label)}</strong><br><span class="small">${esc(c.statement)}</span>
            ${cur ? `<br><span class="small muted">Recorded ${fmtDate(cur.recorded_at)} · v${esc(cur.statement_version)}</span>` : ''}</span></label>`;
        }).join('')}</div>
      </div>
    </section>`);
  $$('[data-consent]').forEach(cb => cb.onchange = async () => {
    const { error } = await sb.rpc('record_consent', { p_org: id, p_key: cb.dataset.consent, p_granted: cb.checked });
    if (error) { cb.checked = !cb.checked; return fail(error); }
    toast('Permission updated');
  });
});
