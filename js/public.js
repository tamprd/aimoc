/* =====================================================================
   AIMOC platform — public.js
   Home, content pages, news, advocacy, member directory, contact, login, unsubscribe
   ===================================================================== */

const postsQuery = kind => sb.from('posts')
  .select('id,kind,slug,title,topic,excerpt,cover_image,document_path,document_name,members_only,published_at')
  .eq('kind', kind).eq('published', true).lte('published_at', new Date().toISOString())
  .order('published_at', { ascending: false });

function postCards(list, { compact = false } = {}) {
  if (!list?.length) return '<p class="muted">Nothing published yet.</p>';
  return `<div class="cards ${compact ? 'compact' : ''}">${list.map(p => `
    <a class="card post-card" href="#/${p.kind === 'submission' ? 'advocacy' : 'news'}/${esc(p.slug)}">
      ${!compact && p.cover_image ? `<img src="${safeUrl(p.cover_image)}" alt="" loading="lazy">` : ''}
      <div class="post-meta">${p.topic ? `<span class="tag">${esc(p.topic)}</span>` : ''}${p.members_only ? '<span class="tag lock">Members</span>' : ''}<span>${fmtDate(p.published_at)}</span></div>
      <h3>${esc(p.title)}</h3>
      ${p.excerpt ? `<p class="muted">${esc(p.excerpt)}</p>` : ''}
      ${p.document_path ? `<span class="doc-pill">📄 ${esc(p.document_name || 'Document')}</span>` : ''}
    </a>`).join('')}</div>`;
}

/* ---------------- home ---------------- */
const ICONS = {
  represent: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="14" r="6"/><circle cx="11" cy="18" r="4.5"/><circle cx="37" cy="18" r="4.5"/><path d="M14 40v-6a10 10 0 0 1 20 0v6"/><path d="M3 38v-4a8 8 0 0 1 11-7.4"/><path d="M45 38v-4a8 8 0 0 0-11-7.4"/></svg>',
  support: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 22l8-8 8 4 6-4 8 2 10 6"/><path d="M4 22l10 12"/><path d="M44 22l-12 13-5-4"/><path d="M14 34l3 3 4-3 4 4 3-2"/><path d="M20 18l-6 6 3 3 7-5 9 8"/></svg>',
  collaborate: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="6"/><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/><circle cx="24" cy="24" r="14"/></svg>',
  grow: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 42h36"/><rect x="9" y="28" width="6" height="12"/><rect x="21" y="20" width="6" height="20"/><rect x="33" y="10" width="6" height="30"/></svg>',
};
const heroStyle = () => (S.settings.hero_image ? ` style="--hero-img:url('${esc(S.settings.hero_image)}')"` : '');

route(/^#?\/?$/, async () => {
  const s = S.settings;
  const [news, subs, counts] = await Promise.all([postsQuery('news').limit(3), postsQuery('submission').limit(3), sb.rpc('public_counts')]);
  const c = counts.data || {};
  render(`
  <section class="hero"${heroStyle()}>
    <div class="wrap">
      <p class="hero-kicker">A stronger, independent</p>
      <h1>Australian <span class="yl">Motorsport.</span></h1>
      <p class="lead">Representing, supporting and advocating for independent motorsport venues, event operators and industry partners across Australia.</p>
      <div class="row">
        <a class="btn" href="#/join">Join AIMOC <span class="arr">→</span></a>
        <a class="btn ghost" href="#/p/about">Learn More</a>
      </div>
      ${c.organisations > 0 ? `<p class="hero-count"><strong>${fmtNum(c.organisations)}</strong> organisations · <strong>${fmtNum(c.disciplines)}</strong> disciplines · <strong>${fmtNum(c.states)}</strong> states &amp; territories</p>` : ''}
    </div>
  </section>
  <section class="pillars"><div class="wrap pillar-grid">
    <div class="pillar">${ICONS.represent}<strong>Represent</strong>A unified voice for independent operators.</div>
    <div class="pillar">${ICONS.support}<strong>Support</strong>Guidance, resources and connections.</div>
    <div class="pillar">${ICONS.collaborate}<strong>Collaborate</strong>Bringing the industry together.</div>
    <div class="pillar">${ICONS.grow}<strong>Grow</strong>A sustainable future for Australian motorsport.</div>
  </div></section>
  <section class="explore"><div class="wrap ex-grid">
    <a class="ex-card" href="#/p/about"${s.card_about_image ? ` style="--img:url('${esc(s.card_about_image)}')"` : ''}>
      <h3>About AIMOC</h3><p class="sub">Independent. United.<br>Driving a stronger future.</p>
      <p>AIMOC is the national representative body for Australia's independent motorsport venues, event operators and industry partners.</p><span class="go">→</span></a>
    <a class="ex-card" href="#/p/membership"${s.card_membership_image ? ` style="--img:url('${esc(s.card_membership_image)}')"` : ''}>
      <h3>Membership</h3><p class="sub">Stronger together.</p>
      <p>Join a growing network of independent operators working for a more sustainable and recognised Australian motorsport industry.</p><span class="go">→</span></a>
    <a class="ex-card" href="#/advocacy"${s.card_advocacy_image ? ` style="--img:url('${esc(s.card_advocacy_image)}')"` : ''}>
      <h3>Advocacy</h3><p class="sub">Real representation.<br>Real change.</p>
      <p>Advocating for fair regulation, practical policy and a supportive environment for independent motorsport operators.</p><span class="go">→</span></a>
  </div></section>
  <section class="wrap band">
    <div class="split">
      <div><h2 class="sec">Current priorities</h2><div class="prose">${md(s.home_priorities)}</div>
        <p><a href="#/p/aims">Read our stated aims →</a></p></div>
      <div><h2 class="sec">Industry news</h2>${postCards(news.data, { compact: true })}<p><a href="#/news">All news →</a></p></div>
    </div>
    ${(subs.data || []).length ? `<h2 class="sec" style="margin-top:28px">Latest submissions</h2>${postCards(subs.data)}` : ''}
  </section>
  <section class="cta-band"><div class="wrap cta-inner">
    <div><h2>People. Venues. Events. Industry. <span class="yl">A stronger tomorrow.</span></h2>
    <p>Registration is free and takes about 10–15 minutes. You control how your information is used.</p></div>
    <a class="btn btn-lg gold" href="#/join">Join AIMOC <span class="arr">→</span></a>
  </div></section>`);
});

/* ---------------- content pages ---------------- */
route(/^#\/p\/([\w-]+)$/, async slug => {
  const { data } = await sb.from('pages').select('*').eq('slug', slug).eq('published', true).maybeSingle();
  if (!data) return notFound();
  render(`<section class="page-head"${heroStyle()}><div class="wrap"><h1>${esc(data.title)}</h1>${data.summary ? `<p class="lead">${esc(data.summary)}</p>` : ''}</div></section>
    <section class="wrap narrow page"><div class="prose">${md(data.body)}</div></section>`);
});

/* ---------------- news + advocacy ---------------- */
function listView(kind) {
  return async () => {
    const { data } = await postsQuery(kind);
    const topics = uniq((data || []).map(p => p.topic).filter(Boolean)).sort();
    const title = kind === 'news' ? 'Industry News' : 'Advocacy & Submissions';
    const lead = kind === 'news'
      ? 'Updates, consultations, announcements and industry issues.'
      : 'Public policy submissions, position papers and consultation responses made by the Council.';
    render(`<section class="page-head"><div class="wrap"><h1>${esc(title)}</h1><p class="lead">${lead}</p></div></section>
      <section class="wrap page">
        ${topics.length > 1 ? `<div class="chips" id="topicChips"><button class="chip active" data-t="">All</button>${topics.map(t => `<button class="chip" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
        <div id="postList">${postCards(data)}</div>
        ${!S.session ? `<p class="muted small">Some briefings are for member organisations only. <a href="#/login">Log in</a> to see everything.</p>` : ''}
      </section>`);
    $('#topicChips')?.addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      $$('#topicChips .chip').forEach(x => x.classList.toggle('active', x === b));
      $('#postList').innerHTML = postCards(b.dataset.t ? data.filter(p => p.topic === b.dataset.t) : data);
    });
  };
}
function detailView(kind) {
  return async slug => {
    const { data: p } = await sb.from('posts').select('*').eq('slug', slug).eq('kind', kind).eq('published', true).maybeSingle();
    const back = kind === 'news' ? '#/news' : '#/advocacy';
    if (!p) {
      return render(`<section class="wrap narrow page"><h1>Not available</h1>
        <p class="muted">This item doesn't exist, or it's for member organisations only.</p>
        ${S.session ? '' : `<div class="row"><a class="btn" href="#/login">Member log in</a><a class="btn ghost" href="#/join">Join AIMOC</a></div>`}</section>`);
    }
    render(`<article class="wrap narrow page">
      <p class="crumb"><a href="${back}">← ${kind === 'news' ? 'Industry News' : 'Advocacy & Submissions'}</a></p>
      <div class="post-meta">${p.topic ? `<span class="tag">${esc(p.topic)}</span>` : ''}${p.members_only ? '<span class="tag lock">Members only</span>' : ''}<span>${fmtDate(p.published_at)}</span></div>
      <h1>${esc(p.title)}</h1>
      ${p.cover_image ? `<img class="cover" src="${safeUrl(p.cover_image)}" alt="">` : ''}
      ${p.document_path ? `<p><button class="btn ghost" type="button" id="docBtn">📄 ${esc(p.document_name || 'Download document')}</button></p>` : ''}
      <div class="prose">${md(p.body)}</div>
    </article>`);
    $('#docBtn')?.addEventListener('click', () => openDocument(p.document_path));
  };
}
route(/^#\/news$/, listView('news'));
route(/^#\/news\/([\w-]+)$/, detailView('news'));
route(/^#\/advocacy$/, listView('submission'));
route(/^#\/advocacy\/([\w-]+)$/, detailView('submission'));

/* ---------------- member directory ---------------- */
route(/^#\/members$/, async () => {
  await loadLookups();
  const { data, error } = await sb.rpc('public_directory');
  if (error) throw error;
  const list = data || [];
  const discs = uniq(list.flatMap(o => o.disciplines || [])).sort();
  render(`<section class="page-head"><div class="wrap"><h1>Member Organisations</h1>
    <p class="lead">Organisations participating in the Council that have chosen to be listed publicly.</p></div></section>
    <section class="wrap page">
      ${S.settings.directory_enabled === false ? '<p class="notice">The public directory is not currently available.</p>' : `
      <div class="filters">
        <input id="dq" type="search" placeholder="Search organisations…" aria-label="Search organisations">
        <select id="ds" aria-label="State"><option value="">All states</option>${STATES.map(s => opt(s, STATE_NAMES[s])).join('')}</select>
        <select id="dd" aria-label="Discipline"><option value="">All disciplines</option>${discs.map(d => opt(d, d)).join('')}</select>
      </div>
      <p class="muted small" id="dcount"></p>
      <div class="dir-grid" id="dgrid"></div>`}
    </section>`);
  if (S.settings.directory_enabled === false) return;
  const draw = () => {
    const q = $('#dq').value.toLowerCase(), st = $('#ds').value, d = $('#dd').value;
    const rows = list.filter(o =>
      (!q || [o.name, o.trading_name, o.description].join(' ').toLowerCase().includes(q)) &&
      (!st || o.state === st || (o.operating_states || []).includes(st)) &&
      (!d || (o.disciplines || []).includes(d)));
    $('#dcount').textContent = `${rows.length} organisation${rows.length === 1 ? '' : 's'}`;
    $('#dgrid').innerHTML = rows.map(o => `
      <article class="card dir-card">
        <div class="dir-top">
          ${o.logo_path ? `<img src="${esc(logoUrl(o.logo_path))}" alt="" loading="lazy">` : `<div class="logo-ph" aria-hidden="true">${esc((o.trading_name || o.name).slice(0, 2).toUpperCase())}</div>`}
          <div><h3>${esc(o.trading_name || o.name)}</h3>${o.trading_name ? `<p class="small muted">${esc(o.name)}</p>` : ''}
          <p class="small">${esc(o.state || '')}${(o.operating_states || []).length ? ' · operates in ' + esc(o.operating_states.join(', ')) : ''}</p></div>
        </div>
        ${o.description ? `<p class="small">${esc(o.description)}</p>` : ''}
        <div class="tags">${(o.categories || []).map(c => `<span class="tag">${esc(c)}</span>`).join('')}${(o.disciplines || []).map(c => `<span class="tag soft">${esc(c)}</span>`).join('')}</div>
        ${o.website ? `<a class="small" href="${safeUrl(/^https?:/.test(o.website) ? o.website : 'https://' + o.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}
      </article>`).join('') || '<p class="muted">No organisations match.</p>';
  };
  ['dq', 'ds', 'dd'].forEach(id => $('#' + id).addEventListener('input', draw));
  draw();
});

/* ---------------- contact ---------------- */
route(/^#\/contact$/, async () => {
  const s = S.settings;
  render(`<section class="page-head"><div class="wrap"><h1>Contact</h1><p class="lead">General enquiries and Council communications.</p></div></section>
    <section class="wrap page split">
      <div>
        <h2 class="sec">Get in touch</h2>
        ${s.contact_email ? `<p><strong>Email</strong><br><a href="mailto:${esc(s.contact_email)}">${esc(s.contact_email)}</a></p>` : ''}
        ${s.contact_phone ? `<p><strong>Phone</strong><br>${esc(s.contact_phone)}</p>` : ''}
        ${s.postal_address ? `<p><strong>Postal address</strong><br>${esc(s.postal_address).replace(/\n/g, '<br>')}</p>` : ''}
        <p class="muted small">Representing an organisation? <a href="#/join">Register it with the Council</a> so we can include you in consultations.</p>
      </div>
      <form id="enq" class="card form">
        ${field('Your name *', '<input name="name" required maxlength="200" autocomplete="name">')}
        ${field('Email *', '<input name="email" type="email" required autocomplete="email">')}
        ${field('Organisation', '<input name="organisation" maxlength="300" autocomplete="organization">')}
        ${field('Phone', '<input name="phone" type="tel" maxlength="50" autocomplete="tel">')}
        ${field('Subject', '<input name="subject" maxlength="300">')}
        ${field('Message *', '<textarea name="message" rows="6" required maxlength="5000"></textarea>')}
        <div class="hp" aria-hidden="true"><label>Leave blank<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <button class="btn" type="submit">Send enquiry</button>
      </form>
    </section>`);
  $('#enq').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.website) return;                       // honeypot
    delete f.website;
    Object.keys(f).forEach(k => { f[k] = f[k].trim() || null; });
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const { error } = await sb.from('enquiries').insert(f);
    btn.disabled = false;
    if (error) return fail(error);
    e.target.outerHTML = `<div class="card sent"><div class="sent-icon">✓</div><h2>Thanks — message received</h2><p>The Council will be in touch.</p></div>`;
  };
});

/* ---------------- login ---------------- */
route(/^#\/login$/, async () => {
  if (S.session) return go(isStaffUser() ? '#/admin' : '#/portal');
  const notice = BOOT.notice; BOOT.notice = null;
  render(`<section class="wrap narrow page">
    <h1>Log in</h1>
    <p class="muted">For organisation representatives and Council administrators.</p>
    ${linkFormHtml({ notice, button: notice ? 'Send a new link' : 'Email me a log-in link' })}
    <p class="muted small">Not registered yet? <a href="#/join">Register your organisation</a></p>
  </section>`);
  wireLinkForm('linkForm', null);
});

/* ---------------- unsubscribe ---------------- */
route(/^#\/unsubscribe\/([0-9a-f-]{36})$/i, async token => {
  render(`<section class="wrap narrow page"><h1>Email preferences</h1>
    <div class="card"><p>Stop receiving Council communications at this address?</p>
    <button class="btn" id="unsub">Unsubscribe</button></div></section>`);
  $('#unsub').onclick = async () => {
    const { data, error } = await sb.rpc('unsubscribe_contact', { token });
    if (error) return fail(error);
    $('.card').innerHTML = data === 'invalid'
      ? `<p class="notice err">This unsubscribe link isn't valid. Please contact the Council.</p>`
      : `<h2>You're unsubscribed</h2><p><strong>${esc(data)}</strong> will no longer receive Council communications.</p>
         <p class="muted small">Changed your mind? Log in and update your preferences under My account, or contact the Council.</p>`;
  };
});
