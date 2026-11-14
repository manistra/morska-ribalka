// Fish library: data from data.js, photos from Wikipedia (the address is remembered on the device)
const photoAlias = {
  'Sphyraena sphyraena': ['European barracuda', 'Sphyraena', 'Barracuda'],
  'Sphyraena viridensis': ['Yellowmouth barracuda']
};

async function findPhotoUrl(latin) {
  const q = encodeURIComponent(latin);
  const wiki = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&pithumbsize=640&titles=';
  const fromPages = root => {
    const pages = root.query && root.query.pages;
    if (!pages) return null;
    let best = null;
    Object.values(pages).forEach(p => {
      const src = (p.thumbnail && p.thumbnail.source) || (p.imageinfo && p.imageinfo[0] && p.imageinfo[0].thumburl);
      if (!src) return;
      const index = p.index || 0;
      if (!best || index < best[0]) best = [index, src];
    });
    return best ? best[1] : null;
  };
  const attempts = (photoAlias[latin] || []).map(a => wiki + encodeURIComponent(a)).concat([
    wiki + q,
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3&gsrsearch=${q}&prop=pageimages&pithumbsize=640`,
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=3&gsrsearch=${q}&prop=imageinfo&iiprop=url&iiurlwidth=640`
  ]);
  for (const url of attempts) {
    try {
      const found = fromPages(await getJson(url, 10000));
      if (found && !/\.svg(\/|$)/i.test(found)) return found;
    } catch (e) { /* try the next method */ }
  }
  return null;
}

// queue, so we do not fire dozens of requests at once
const photoQueue = { running: 0, waiting: [] };
function runPhotoJob(job) {
  return new Promise(resolve => {
    const go = () => {
      photoQueue.running++;
      job().then(resolve, () => resolve(null)).finally(() => {
        photoQueue.running--;
        const next = photoQueue.waiting.shift();
        if (next) next();
      });
    };
    if (photoQueue.running < 3) go(); else photoQueue.waiting.push(go);
  });
}

function photoUrlFor(latin) {
  const cached = Store.get('photo.' + latin, null);
  if (cached) return Promise.resolve(cached);
  return runPhotoJob(async () => {
    const url = await findPhotoUrl(latin);
    if (url) Store.set('photo.' + latin, url);
    return url;
  });
}

// Image with lazy loading; tapping the gray placeholder retries
function fishPhoto(latin, cls) {
  const box = h('div', { class: 'photo ' + (cls || '') });
  const img = h('img', { alt: latin, loading: 'lazy' });
  const load = () => {
    box.classList.remove('failed');
    photoUrlFor(latin).then(url => {
      if (!url) { box.classList.add('failed'); return; }
      img.onerror = () => { Store.set('photo.' + latin, null); box.classList.add('failed'); };
      img.onload = () => box.classList.add('ready');
      img.src = url;
    });
  };
  box.appendChild(img);
  box.addEventListener('click', () => { if (box.classList.contains('failed')) load(); });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '200px' });
    // observe after insertion into the document
    setTimeout(() => io.observe(box), 0);
  } else load();
  return box;
}

// attach extended data: lionfish and new fields
(function () {
  if (!window.FISHX) return;
  FISHX.extra.forEach(e => { if (!DATA.lib.some(f => f.key === e.key)) DATA.lib.push(e); });
})();

// First letters of months from our own table: a browser without the needed language substituted the system language (Cyrillic)
const MONTHS = {
  en: 'JFMAMJJASOND', sr: 'JFMAMJJASOND', hr: 'SVOTSLSKRLSP', it: 'GFMAMGLASOND',
  el: 'ΙΦΜΑΜΙΙΑΣΟΝΔ', sq: 'JSMPMQKGSTND', sl: 'JFMAMJJASOND', de: 'JFMAMJJASOND', es: 'EFMAMJJASOND', tr: 'OŞMNMHTAEEKA'
};
function seasonBar(months) {
  const names = [tr('No','Ne'), tr('Weak','Slabo'), tr('Good','Dobro'), tr('Peak','Vrhunac')];
  const m = [...(MONTHS[Lang.current] || MONTHS.en)];
  const wrap = h('div', { class: 'sbar' });
  months.forEach((v, i) => wrap.appendChild(h('div', { class: 'sb s' + v, title: names[v] }, h('i', null), h('b', null, m[i]))));
  return wrap;
}

function recipeBlock(S, fkey, r, idx, rerender) {
  const id = fkey + '#' + idx;
  const open = S.recOpen === id;
  const box = h('div', { class: 'recipe' });
  box.appendChild(h('div', { class: 'row click', onclick: () => { S.recOpen = open ? null : id; rerender(); } },
    h('b', null, '🍽 ' + t3(r.title)),
    h('span', { class: 'link' }, open ? '▲' : '▼')));
  if (open) {
    box.appendChild(small(r.min + ' ' + tr('min', 'min') + ' · ' + r.serves + ' ' + tr('servings', 'porcija')));
    box.appendChild(infoRow(tr('Ingredients', 'Namirnice'), t3(r.ingr)));
    r.steps.forEach((st, i) => box.appendChild(h('p', null, (i + 1) + '. ' + t3(st))));
  }
  return box;
}

const libTitle = f => {
  const names = fishNames(f.key);
  if (names && names.length) return names.length > 1 ? `${names[0]} (${names[1]})` : names[0];
  return f.en ? tr(f.en, f.sr || f.en) : fishLabel(f.key);
};

// Species whose shared rule field holds a safety warning rather than a legal limit
const safetyRuleKeys = new Set(['Black scorpionfish', 'Red scorpionfish', 'Greater weever', 'European conger', 'Mediterranean moray', 'Red lionfish']);

const sizeText = s => s;

// Rule text for a species in the selected country and region: size, ban, note, safety.
// If the region has an area with its own rules (ES-CT), use those, otherwise the country's rules.
function fishRuleText(f, code, area) {
  const byArea = area && SITE_DATA.fish[code + '-' + area.code];
  const r = (byArea && byArea[f.key]) || (SITE_DATA.fish[code] || {})[f.key];
  const parts = [];
  if (r && r.min) parts.push(tr('Minimum size', 'Minimalna veličina') + ' ' + sizeText(r.min) + ' (' + r.src + ').');
  if (r && r.closed) parts.push(tr('Closed season', 'Lovostaj') + ': ' + r.closed + '.');
  if (r && r.note) parts.push(t3(SITE_DATA.notes[r.note]));
  if (safetyRuleKeys.has(f.key)) parts.push(t3(f.rule));
  return parts.join(' ');
}

function renderLibrary(S, rerender) {
  const groups = [
    [0, tr('Fish', 'Ribe')],
    [1, tr('Cephalopods', 'Glavonošci')],
    [2, tr('Crustaceans', 'Rakovi')]
  ];
  const out = [h('h2', { class: 'page' }, tr('Fish', 'Ribe') + ' · ' + Country.sea())];

  const rules = Country.rules();
  const area = Country.area(S.region);
  const rulesCard = card(tr('Main rules and laws', 'Osnovna pravila i zakoni'),
    h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); S.rulesOpen = !S.rulesOpen; rerender(); } },
      S.rulesOpen ? tr('Collapse ▲', 'Skupi ▲') : tr('Show ▼', 'Prikaži ▼')));
  if (S.rulesOpen) {
    rules.slice(0, rules.length - 2).forEach(r => rulesCard.appendChild(h('p', null, '• ' + t3(r))));
    // Rules of the selected region's area
    if (area && area.rules.length) {
      rulesCard.appendChild(h('h3', null, t3(area.name)));
      area.rules.forEach(r => rulesCard.appendChild(h('p', null, '• ' + t3(r))));
    }
    rulesCard.appendChild(small(t3(rules[rules.length - 2])));
    rulesCard.appendChild(small(t3(rules[rules.length - 1])));
  }
  out.push(rulesCard);

  groups.forEach(([g, title]) => {
    const list = DATA.lib.filter(f => f.group === g && Country.visible(f));
    if (!list.length) return;
    out.push(h('h2', { class: 'group' }, title));
    list.forEach(f => {
      const open = S.libOpen === f.key;
      const c = card(libTitle(f) + '  ·  ' + f.latin);
      const toggle = () => { S.libOpen = open ? null : f.key; rerender(); };
      const head = h('div', { class: 'row click', onclick: toggle },
        open ? null : fishPhoto(f.latin, 'thumb'),
        h('span', { class: 'link' }, open ? tr('Collapse ▲', 'Skupi ▲') : tr('Details ▼', 'Detalji ▼')));
      c.appendChild(head);
      if (open) {
        c.appendChild(fishPhoto(f.latin, 'big'));
        c.appendChild(infoRow(tr('Where', 'Gdje'), t3(f.where)));
        c.appendChild(infoRow(tr('Bait and lures', 'Mamci i varalice'), t3(f.bait)));
        c.appendChild(infoRow(tr('Active hours', 'Aktivni sati'), t3(f.hours)));
        c.appendChild(infoRow(tr('Season', 'Sezona'), t3(f.season)));
        c.appendChild(infoRow(tr('Rules', 'Pravila'), fishRuleText(f, Country.code, area)));
        const x = window.FISHX && FISHX.sp[f.key];
        if (x) {
          c.appendChild(infoRow(tr('Habits', 'Navike'), t3(x.habits)));
          c.appendChild(seasonBar(x.months));
          if (x.safety) c.appendChild(h('div', { class: 'warn' }, '⚠ ' + t3(x.safety)));
          if (x.noeat) c.appendChild(h('div', { class: 'warn' }, '🚫 ' + t3(x.noeat)));
          if (x.rec.length) {
            c.appendChild(h('h3', { class: 'recs' }, tr('What to cook', 'Što skuhati')));
            x.rec.forEach((r, i) => c.appendChild(recipeBlock(S, f.key, r, i, rerender)));
          }
        }
      }
      out.push(c);
    });
  });

  out.push(small(t3(SITE_DATA.footnote)));
  return out;
}
