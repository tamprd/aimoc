/* =====================================================================
   AIMOC platform — reports.js
   Industry intelligence: filtered, consent-aware, overlap-aware totals,
   coverage + limitations, CSV / Excel / PDF briefing exports
   ===================================================================== */

const SMALL_GROUP = 3;   // fewer contributing organisations than this → identification warning
let RPT = null;          // loaded data
let rptF = { states: [], hqOnly: false, discs: [], cats: [], includePending: false, verifiedOnly: false, attribute: false };

adminRoute(/^#\/admin\/reports$/, 'reports', async () => {
  const [orgs, subs, cons, aff] = await Promise.all([
    fetchAll('organisations', 'id,legal_name,trading_name,state,operating_states,status,organisation_categories(category_id),organisation_disciplines(discipline_id)', 'legal_name'),
    fetchAll('stat_submissions', 'id,org_id,period_label,period_start,period_end,includes_affiliates,source_note,verified_at,updated_at,is_current,stat_values(metric_key,answer,value,precision)').then(r => r.filter(s => s.is_current)),
    fetchAll('organisation_consent_current', 'org_id,consent_key,granted'),
    fetchAll('organisation_affiliations', '*'),
  ]);
  const consent = {};
  cons.forEach(c => { (consent[c.org_id] ||= {})[c.consent_key] = c.granted; });
  RPT = { orgs, subByOrg: Object.fromEntries(subs.map(s => [s.org_id, s])), consent, aff };

  const multi = (name, items, sel) => `<details class="card sub"><summary>${name} <span class="small muted" data-cnt="${name}"></span></summary>
    <div class="stack">${items.map(([v, l]) => chk('f_' + name, v, sel.map(String).includes(String(v)), esc(l))).join('')}</div></details>`;
  amain(`<div class="ahead"><div><h1>Industry reports</h1><p class="muted">Live figures supplied by member organisations. Totals respect each organisation's data-sharing permissions.</p></div>
      <div class="row"><button class="btn btn-sm" id="xPdf" type="button">Briefing (PDF)</button><button class="btn btn-sm ghost" id="xXlsx" type="button">Excel</button><button class="btn btn-sm ghost" id="xCsv" type="button">CSV</button></div></div>
    <div class="split" style="grid-template-columns:260px 1fr;align-items:start">
      <form id="rf" class="stack">
        <div class="card sub"><strong>State or territory</strong><div class="state-grid">${STATES.map(s => chk('f_state', s, rptF.states.includes(s), s)).join('')}</div>
          ${chk('f_hq', '1', rptF.hqOnly, 'Head office only (ignore operating states)')}</div>
        ${multi('Discipline', S.L.disciplines.map(d => [d.id, d.name]), rptF.discs)}
        ${multi('Category', S.L.categories.map(d => [d.id, d.name]), rptF.cats)}
        <div class="card sub stack">
          ${chk('f_pending', '1', rptF.includePending, 'Include organisations awaiting approval')}
          ${chk('f_verified', '1', rptF.verifiedOnly, 'Verified statistics only')}
          ${chk('f_attr', '1', rptF.attribute, 'Show named figures in briefing (only orgs that allow attribution)')}
        </div>
        <button class="btn btn-sm ghost" type="button" id="fClear">Clear filters</button>
      </form>
      <div id="rOut"></div>
    </div>`);
  const read = () => {
    const f = $('#rf');
    rptF = { states: checkedValues(f, 'f_state'), hqOnly: f.f_hq.checked, discs: checkedValues(f, 'f_Discipline'), cats: checkedValues(f, 'f_Category'), includePending: f.f_pending.checked, verifiedOnly: f.f_verified.checked, attribute: f.f_attr.checked };
    $('[data-cnt=Discipline]').textContent = rptF.discs.length ? `(${rptF.discs.length})` : '';
    $('[data-cnt=Category]').textContent = rptF.cats.length ? `(${rptF.cats.length})` : '';
    drawReport();
  };
  $('#rf').addEventListener('change', read);
  $('#fClear').onclick = () => { $$('#rf input[type=checkbox]').forEach(i => { i.checked = false; }); read(); };
  $('#xCsv').onclick = () => exportCsv(computeReport());
  $('#xXlsx').onclick = () => exportXlsx(computeReport()).catch(fail);
  $('#xPdf').onclick = () => printBriefing(computeReport());
  read();
});

/* ---------------- computation ---------------- */
function filterLabel(f = rptF) {
  const p = [];
  p.push(f.states.length ? f.states.map(s => STATE_NAMES[s]).join(', ') + (f.hqOnly ? ' (head office)' : '') : 'All states and territories');
  p.push(f.discs.length ? f.discs.map(id => nameOf(S.L.disciplines, id)).join(', ') : 'all disciplines');
  if (f.cats.length) p.push(f.cats.map(id => nameOf(S.L.categories, id)).join(', '));
  return p.join(' · ');
}

function computeReport() {
  const f = rptF, { orgs, subByOrg, consent, aff } = RPT;
  const inSet = orgs.filter(o =>
    (o.status === 'approved' || (f.includePending && o.status === 'pending')) &&
    (!f.states.length || f.states.includes(o.state) || (!f.hqOnly && (o.operating_states || []).some(s => f.states.includes(s)))) &&
    (!f.discs.length || o.organisation_disciplines.some(d => f.discs.includes(String(d.discipline_id)))) &&
    (!f.cats.length || o.organisation_categories.some(c => f.cats.includes(String(c.category_id)))));
  const ids = new Set(inSet.map(o => o.id));
  const allowAgg = id => consent[id]?.aggregate_stats === true;
  const subOf = id => { const s = subByOrg[id]; return s && (!f.verifiedOnly || s.verified_at) ? s : null; };

  const withSub = inSet.filter(o => subOf(o.id));
  const usable = withSub.filter(o => allowAgg(o.id));
  const noConsent = withSub.filter(o => !allowAgg(o.id));

  // known overlaps inside the filtered set: child's figures already inside a parent's
  const overlapPairs = aff.filter(a => a.figures_included_in_parent && ids.has(a.child_org_id) && ids.has(a.parent_org_id));

  const metrics = activeList(S.L.metrics).map(m => {
    const r = { m, sum: 0, n: 0, exact: 0, estimate: 0, verified: 0, na: 0, unknown: 0, undisclosed: 0, noResponse: 0, overlapDeduct: 0, overlapOrgs: 0, values: [] };
    for (const o of usable) {
      const v = subOf(o.id).stat_values.find(x => x.metric_key === m.key);
      if (!v) { r.noResponse++; continue; }
      if (v.answer === 'reported') {
        r.sum += Number(v.value); r.n++; r[v.precision === 'exact' ? 'exact' : 'estimate']++;
        if (subOf(o.id).verified_at) r.verified++;
        r.values.push({ org: o, value: Number(v.value), precision: v.precision });
      } else if (v.answer === 'not_applicable') r.na++;
      else if (v.answer === 'unknown') r.unknown++;
      else r.undisclosed++;
    }
    r.noResponse += inSet.length - withSub.length;   // orgs with no statistics at all
    if (m.overlap_sensitive) {
      const reported = new Map(r.values.map(x => [x.org.id, x.value]));
      const counted = new Set();
      for (const a of overlapPairs) {
        if (reported.has(a.child_org_id) && reported.has(a.parent_org_id) && !counted.has(a.child_org_id)) {
          r.overlapDeduct += reported.get(a.child_org_id); r.overlapOrgs++; counted.add(a.child_org_id);
        }
      }
    }
    r.adjusted = r.sum - r.overlapDeduct;
    r.small = r.n > 0 && r.n < SMALL_GROUP;
    return r;
  });

  const tally = (getIds, list) => list.map(x => ({ name: x.name, count: inSet.filter(o => getIds(o).includes(x.id)).length })).filter(x => x.count).sort((a, b) => b.count - a.count);
  const periods = {}; withSub.forEach(o => { const p = subOf(o.id).period_label; periods[p] = (periods[p] || 0) + 1; });
  const dates = withSub.map(o => subOf(o.id).updated_at).sort();
  const unlinkedIncludes = usable.filter(o => subOf(o.id).includes_affiliates && !aff.some(a => a.parent_org_id === o.id)).length;

  return {
    filters: { ...f }, label: filterLabel(f), generated: new Date(),
    orgs: inSet, withSub, usable, noConsent, metrics, overlapPairs, unlinkedIncludes,
    byCategory: tally(o => o.organisation_categories.map(c => c.category_id), S.L.categories),
    byDiscipline: tally(o => o.organisation_disciplines.map(c => c.discipline_id), S.L.disciplines),
    byState: STATES.map(s => ({ name: s, count: inSet.filter(o => o.state === s).length })).filter(x => x.count),
    periods, oldest: dates[0], newest: dates.at(-1),
    verifiedCount: withSub.filter(o => subOf(o.id).verified_at).length,
    identifiable: inSet.filter(o => consent[o.id]?.identify_member),
    attributable: o => consent[o.id]?.attribute_stats === true && consent[o.id]?.aggregate_stats === true,
    subOf,
  };
}

/* ---------------- on-screen ---------------- */
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
function bars(list, total) {
  if (!list.length) return '<p class="muted small">None.</p>';
  const max = Math.max(...list.map(x => x.count));
  return `<div class="bar-list">${list.map(x => `<div class="bar-item"><span>${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.count / max) * 100}%"></div></div><span class="num">${x.count}</span></div>`).join('')}</div>
    ${total ? `<p class="small muted">Organisations can appear in more than one row.</p>` : ''}`;
}
function metricRows(R) {
  return R.metrics.map(r => `<tr>
    <td><strong>${esc(r.m.label)}</strong> <span class="kind kind-${r.m.kind}">${r.m.kind === 'people' ? 'people' : r.m.kind}</span>${r.small ? ' <span class="pill-note" title="Fewer than 3 organisations reported — figures may identify them">small group</span>' : ''}</td>
    <td class="num"><strong>${r.n ? fmtNum(r.adjusted) : '—'}</strong>${r.overlapDeduct ? `<br><span class="small muted">sum ${fmtNum(r.sum)} − ${fmtNum(r.overlapDeduct)} overlap</span>` : ''}</td>
    <td class="num">${r.n}</td>
    <td class="num">${r.n ? pct(r.estimate, r.n) : '—'}</td>
    <td class="num">${r.n ? pct(r.verified, r.n) : '—'}</td>
    <td class="small">${[r.na && `${r.na} n/a`, r.unknown && `${r.unknown} unknown`, r.undisclosed && `${r.undisclosed} withheld`, r.noResponse && `${r.noResponse} no response`].filter(Boolean).join(' · ')}</td></tr>`).join('');
}
function drawReport() {
  const R = computeReport();
  const total = R.orgs.length;
  $('#rOut').innerHTML = `
    <p class="small"><strong>Showing:</strong> ${esc(R.label)}${rptF.includePending ? ' · incl. pending' : ''}${rptF.verifiedOnly ? ' · verified only' : ''}</p>
    <div class="kpis">
      <div class="kpi"><strong>${total}</strong><span>Represented organisations</span></div>
      <div class="kpi"><strong>${R.withSub.length}</strong><span>Supplied statistics (${pct(R.withSub.length, total)})</span></div>
      <div class="kpi"><strong>${R.usable.length}</strong><span>Included in totals</span></div>
      <div class="kpi ${R.noConsent.length ? 'alert' : ''}"><strong>${R.noConsent.length}</strong><span>Excluded — no permission to aggregate</span></div>
      <div class="kpi"><strong>${R.verifiedCount}</strong><span>Verified by the Council</span></div>
    </div>
    <div class="card"><h2>Reported figures</h2>
      <div class="table-wrap" style="max-height:none"><table class="tbl"><thead><tr><th>Measure</th><th class="num">Total</th><th class="num">Orgs reporting</th><th class="num">Estimated</th><th class="num">Verified</th><th>Other responses</th></tr></thead>
      <tbody>${metricRows(R)}</tbody></table></div>
      <p class="small muted">"People" totals add up each organisation's count of unique people — a person who belongs to two organisations is counted twice unless the Council has linked the organisations as affiliates. Entries, events and attendance are activity counts, not people.</p>
      ${R.overlapPairs.length ? `<p class="small">Overlap adjustment applied for ${R.overlapPairs.length} known affiliation(s) where the parent's figures already include the affiliate.</p>` : ''}
      ${R.unlinkedIncludes ? `<p class="notice small">${R.unlinkedIncludes} organisation(s) say their figures include affiliated clubs, but no affiliates are linked. Link them under Organisations → Affiliations so overlaps can be removed.</p>` : ''}
    </div>
    <div class="split">
      <div class="card"><h2>By category</h2>${bars(R.byCategory, true)}</div>
      <div class="card"><h2>By state (head office)</h2>${bars(R.byState)}</div>
    </div>
    <div class="card"><h2>By discipline</h2>${bars(R.byDiscipline, true)}</div>
    <div class="card"><h2>Data coverage</h2>
      <dl class="dl">
        <dt>Reporting periods</dt><dd>${Object.entries(R.periods).map(([p, n]) => `${esc(p)} (${n})`).join(' · ') || '—'}</dd>
        <dt>Last updated</dt><dd>${R.oldest ? `${fmtDate(R.oldest)} – ${fmtDate(R.newest)}` : '—'}</dd>
        <dt>No statistics</dt><dd>${total - R.withSub.length} of ${total} organisations</dd>
        <dt>Identifiable</dt><dd>${R.identifiable.length} organisation(s) allow AIMOC to name them as participants</dd>
      </dl></div>`;
}

/* ---------------- exports ---------------- */
function limitationsList(R) {
  const L = [];
  L.push(`Figures were supplied directly by participating organisations and ${R.verifiedCount === R.withSub.length && R.withSub.length ? 'have all been verified by the Council' : `${R.verifiedCount} of ${R.withSub.length} submissions have been verified by the Council`}.`);
  L.push(`${R.withSub.length} of ${R.orgs.length} represented organisations supplied statistics${R.noConsent.length ? `; ${R.noConsent.length} were excluded because they have not permitted use in aggregated reports` : ''}.`);
  L.push('Totals of people (members, licence holders, participants, volunteers) are sums of each organisation\'s unique count. Individuals who belong to more than one organisation may be counted more than once.');
  if (R.overlapPairs.length) L.push(`Known overlaps between ${R.overlapPairs.length} affiliated organisation pair(s) have been removed from the totals.`);
  L.push('Entries, events and attendance are activity counts and must not be read as numbers of people.');
  const est = R.metrics.reduce((a, r) => a + r.estimate, 0), all = R.metrics.reduce((a, r) => a + r.n, 0);
  if (all) L.push(`${pct(est, all)} of reported figures are estimates.`);
  if (R.metrics.some(r => r.small)) L.push(`Some measures are based on fewer than ${SMALL_GROUP} organisations and may allow individual organisations to be identified.`);
  if (Object.keys(R.periods).length > 1) L.push('Organisations reported over different periods (listed below); figures are combined as supplied.');
  return L;
}
function metricExportRows(R) {
  return R.metrics.map(r => ({
    Measure: r.m.label, Kind: r.m.kind, Total: r.n ? r.adjusted : '', 'Sum before overlap adjustment': r.n ? r.sum : '', 'Overlap removed': r.overlapDeduct || 0,
    'Organisations reporting': r.n, Exact: r.exact, Estimated: r.estimate, Verified: r.verified,
    'Not applicable': r.na, Unknown: r.unknown, 'Prefer not to disclose': r.undisclosed, 'No response': r.noResponse,
    'Small-group warning': r.small ? 'Yes' : '',
  }));
}
function exportCsv(R) {
  const rows = metricExportRows(R);
  downloadCsv(rows, Object.keys(rows[0] || { Measure: 1 }).map(k => ({ label: k, key: k })), `aimoc-industry-figures-${today()}.csv`);
}
async function exportXlsx(R) {
  await loadScript(XLSX_SRC);
  const wb = XLSX.utils.book_new();
  const summary = [
    ['AIMOC industry figures'], ['Filters', R.label + (R.filters.includePending ? ' (incl. pending)' : '') + (R.filters.verifiedOnly ? ' (verified only)' : '')],
    ['Generated', R.generated.toLocaleString('en-AU')], [],
    ['Represented organisations', R.orgs.length], ['Supplied statistics', R.withSub.length], ['Included in totals', R.usable.length],
    ['Excluded (no permission to aggregate)', R.noConsent.length], ['Verified submissions', R.verifiedCount], [],
    ['Reporting periods', Object.entries(R.periods).map(([p, n]) => `${p} (${n})`).join('; ')],
    ['Data last updated', R.oldest ? `${fmtDate(R.oldest)} – ${fmtDate(R.newest)}` : ''], [],
    ['Limitations'], ...limitationsList(R).map(l => ['', l]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metricExportRows(R)), 'Figures');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(R.byCategory.map(x => ({ Category: x.name, Organisations: x.count }))), 'By category');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(R.byState.map(x => ({ State: x.name, Organisations: x.count }))), 'By state');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(R.byDiscipline.map(x => ({ Discipline: x.name, Organisations: x.count }))), 'By discipline');
  // internal organisation-level sheet
  const metrics = activeList(S.L.metrics);
  const orgRows = R.orgs.map(o => {
    const s = R.subOf(o.id), c = RPT.consent[o.id] || {};
    const row = {
      Organisation: orgName(o), State: o.state, Status: o.status,
      'Aggregate OK': c.aggregate_stats ? 'Yes' : 'No', 'Attribute OK': c.attribute_stats ? 'Yes' : 'No', 'Identify OK': c.identify_member ? 'Yes' : 'No',
      Period: s?.period_label || '', Verified: s?.verified_at ? 'Yes' : 'No', 'Last updated': s ? fmtDate(s.updated_at) : '',
    };
    metrics.forEach(m => {
      const v = s?.stat_values.find(x => x.metric_key === m.key);
      row[m.label] = !v ? '' : v.answer === 'reported' ? Number(v.value) : ANSWERS[v.answer];
      row[m.label + ' (accuracy)'] = v?.precision || '';
    });
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orgRows.length ? orgRows : [{ note: 'none' }]), 'INTERNAL - by organisation');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['The "INTERNAL - by organisation" sheet contains organisation-level figures.'],
    ['Do not share it outside the Council. Only figures from organisations with "Attribute OK = Yes" may be quoted by name;'],
    ['"Share with government" permission is separate and may require further approval.'],
  ]), 'Read me');
  XLSX.writeFile(wb, `aimoc-industry-figures-${today()}.xlsx`);
}

function printBriefing(R) {
  const s = S.settings;
  const headline = ['affiliated_clubs', 'competition_licences', 'unique_participants', 'annual_events', 'venues', 'individual_members'];
  const hl = headline.map(k => R.metrics.find(r => r.m.key === k)).filter(r => r && r.n);
  const named = R.identifiable.map(orgName).sort();
  const attributable = R.filters.attribute ? R.usable.filter(R.attributable) : [];
  $('#printArea').innerHTML = `
    <p style="font-size:9pt;color:#555">${esc(s.council_name)} · Industry briefing · ${R.generated.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <h1>Independent motorsport: ${esc(R.label)}</h1>
    <p>This briefing summarises figures supplied directly to ${esc(s.short_name || 'AIMOC')} by participating independent motorsport organisations.</p>
    <h2>Summary</h2>
    <table class="tbl"><tbody>
      <tr><td>Represented organisations</td><td class="num"><strong>${R.orgs.length}</strong></td><td></td></tr>
      ${hl.map(r => `<tr><td>${esc(r.m.label)}</td><td class="num"><strong>${fmtNum(r.adjusted)}</strong></td><td style="font-size:9pt">${r.n} organisation(s) reporting${r.estimate ? `; ${pct(r.estimate, r.n)} estimated` : ''}${r.small ? '; small group' : ''}</td></tr>`).join('')}
    </tbody></table>
    <h2>All reported measures</h2>
    <table class="tbl"><thead><tr><th>Measure</th><th class="num">Total</th><th class="num">Orgs reporting</th><th class="num">Estimated</th><th class="num">Verified</th></tr></thead><tbody>
      ${R.metrics.map(r => `<tr><td>${esc(r.m.label)}${r.m.kind === 'people' ? ' (people)' : ''}</td><td class="num">${r.n ? fmtNum(r.adjusted) : '—'}</td><td class="num">${r.n}</td><td class="num">${r.n ? pct(r.estimate, r.n) : '—'}</td><td class="num">${r.n ? pct(r.verified, r.n) : '—'}</td></tr>`).join('')}
    </tbody></table>
    <h2>Representation</h2>
    <table class="tbl"><tbody>${R.byCategory.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${x.count}</td></tr>`).join('')}</tbody></table>
    ${R.byDiscipline.length ? `<p style="font-size:9.5pt"><strong>Disciplines:</strong> ${R.byDiscipline.map(x => `${esc(x.name)} (${x.count})`).join(', ')}</p>` : ''}
    ${named.length ? `<p style="font-size:9.5pt"><strong>Participating organisations include:</strong> ${named.map(esc).join(', ')}${R.orgs.length > named.length ? `, and ${R.orgs.length - named.length} other organisation(s)` : ''}.</p>` : ''}
    ${attributable.length ? `<h2>Figures attributable to named organisations</h2><table class="tbl"><thead><tr><th>Organisation</th>${hl.map(r => `<th class="num">${esc(r.m.label)}</th>`).join('')}</tr></thead><tbody>
      ${attributable.map(o => `<tr><td>${esc(orgName(o))}</td>${hl.map(r => { const v = r.values.find(x => x.org.id === o.id); return `<td class="num">${v ? fmtNum(v.value) + (v.precision === 'estimate' ? '*' : '') : '—'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table><p style="font-size:8.5pt">* estimate. Included with each organisation's permission to attribute figures by name.</p>` : ''}
    <h2>Reporting period and sources</h2>
    <p style="font-size:9.5pt">Reporting periods: ${Object.entries(R.periods).map(([p, n]) => `${esc(p)} (${n} organisation${n > 1 ? 's' : ''})`).join('; ') || 'n/a'}.
      Data last updated ${R.oldest ? `${fmtDate(R.oldest)} – ${fmtDate(R.newest)}` : 'n/a'}. Source: statistics supplied by organisations through the ${esc(s.short_name || 'AIMOC')} registration and update process.</p>
    <h2>Coverage and limitations</h2>
    <ul style="font-size:9.5pt">${limitationsList(R).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <h2>Sharing permissions</h2>
    <p style="font-size:9.5pt">Totals include only organisations that have permitted use of their statistics in aggregated reports. Organisations are named only where they have agreed to be identified as participants, and figures are attributed only where they have agreed to attribution. This briefing does not authorise disclosure of organisation-specific information to government or third parties, which requires separate permission.</p>`;
  window.print();
}
