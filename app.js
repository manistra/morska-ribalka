// Main file: state, tab switching, data loading, startup
const APP_VERSION = '1.14.0';
const STALE_MS = 30 * 60 * 1000;
const WEATHER_RETRY_MS = 2 * 60 * 1000;
const THEMES = ['sea', 'light', 'sand'];
const THEME_COLORS = { sea: ['#0B5C8E', '#0A1822'], light: ['#F6F7F5', '#F6F7F5'], sand: ['#F5ECDD', '#F5ECDD'] };

const S = {
  region: 'Herceg Novi', selected: null, boat: false, fish: null,
  data: null, error: false, days: [], hourly: null, air: null,
  slot: 0, loadedAt: 0, staleTry: 0,
  mySpots: [], tab: 0, showSettings: false, mapFocus: null, pick: null,
  diarySub: 0, draft: null, editNote: null, mark: null, slider: 10,
  rulesOpen: false, libOpen: null, aboutOpen: false, theme: 0,
  gps: { code: 0, acc: 0, loading: false }, token: 0, pending: false,
  updateReady: false, reload: null, picker: false
};

const $ = id => document.getElementById(id);
let lastTab = -1;

// ---------- Actions ----------
const A = {
  rerender() { render(); },
  openSettings() { S.showSettings = true; render(); },
  closeSettings() { S.showSettings = false; render(); },
  applyTheme() {
    const name = THEMES[S.theme] || 'sea';
    document.documentElement.dataset.theme = name;
    const dark = name === 'sea' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', THEME_COLORS[name][dark ? 1 : 0]);
    if (typeof Bg !== 'undefined') Bg.theme();
  },
  setBoat(v) {
    S.boat = v; Store.set('boat', v);
    S.fish = pickFish(v);
    const spots = regionSpots(S.region);
    if (!v && (S.selected.lat === spots[1].lat || S.selected.lat === spots[2].lat) && (S.selected.lon === spots[1].lon || S.selected.lon === spots[2].lon)) {
      S.selected = spots[0]; S.reload(); return;
    }
    render();
  },
  setFish(name) {
    S.fish = fishFor(S.boat).find(f => f.name === name) || fishFor(S.boat)[0];
    Store.set(S.boat ? 'fish_boat' : 'fish_shore', S.fish.name);
    render();
  },
  // country choice: sets the country's language (if requested), regions, the point, and reloads data
  setCountry(code, withLang) {
    Country.set(code);
    if (withLang) Lang.set(Country.data.lang);
    refreshRegions();
    S.picker = false;
    S.region = REGIONS[0].key; Store.set('region', S.region);
    S.selected = regionSpots(S.region)[0];
    S.fish = pickFish(S.boat);
    S.libOpen = null; S.rulesOpen = false;
    render(true);
    S.reload();
  },
  setRegion(key) {
    if (key === S.region) return;
    S.region = key; Store.set('region', key);
    S.selected = regionSpots(key)[0];
    S.reload();
  },
  select(spot) { S.selected = spot; S.reload(); },
  addSpot(spot) {
    S.mySpots.push(spot); Store.set('my_spots', S.mySpots);
    render(); MapUI.ready(S);
  },
  removeSpot(i) { S.mySpots.splice(i, 1); Store.set('my_spots', S.mySpots); render(); },
  gps() {
    if (!navigator.geolocation) { S.gps = { code: 1, acc: 0, loading: false }; render(); return; }
    S.gps = { code: 0, acc: 0, loading: true }; render();
    navigator.geolocation.getCurrentPosition(pos => {
      const acc = Math.round(pos.coords.accuracy || -1);
      S.gps = { code: acc > 200 ? 3 : 2, acc, loading: false };
      S.selected = { name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude };
      S.reload();
    }, err => {
      S.gps = { code: err && err.code === 1 ? 5 : 1, acc: 0, loading: false };
      render();
    }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
  },
  pickOnMap(req) { S.pick = req; S.showSettings = false; S.tab = 3; S.mapFocus = null; render(true); },
  showOnMap(p) { S.mapFocus = p; S.pick = null; S.tab = 3; render(true); },
  updateBanner() {
    return h('div', { class: 'warn caution row' },
      h('span', { class: 'grow' }, tr('A new version of the app is available.', 'Dostupna je nova verzija aplikacije.')),
      btn(tr('Update', 'Ažuriraj'), () => {
        if (S.waitingWorker) S.waitingWorker.postMessage({ type: 'SKIP_WAITING' }); else location.reload();
      }, { primary: true }));
  }
};

const mapHooks = {
  consumeFocus() { S.mapFocus = null; },
  cancelPick() {
    const kind = S.pick && S.pick.kind;
    S.pick = null; S.tab = kind === 'location' ? 0 : 4; render(true);
  },
  picked(point) {
    const p = S.pick; S.pick = null;
    if (!p) return;
    if (p.kind === 'location') { S.selected = { name: 'Map point', lat: point.lat, lon: point.lon }; S.tab = 0; S.reload(); render(true); }
    else if (p.kind === 'diary') { S.draft.point = point; S.diarySub = 0; S.tab = 4; render(true); }
    else if (p.kind === 'entry') {
      // new point: conditions will be refetched if data for that day is still available
      const e = Diary.load().find(x => x.id === p.id);
      Diary.update(p.id, { lat: point.lat, lon: point.lon, pending: !!(e && (e.pending || canReload(e.time))) });
      S.pendingTriedAt = 0;
      S.diarySub = 1; S.tab = 4; render(true);
    }
  },
  useSpot(spot) { S.pick = null; S.tab = 0; S.selected = spot; S.reload(); render(true); },
  saveSpot(spot) { A.addSpot(spot); }
};

function pickFish(boat) {
  const name = Store.get(boat ? 'fish_boat' : 'fish_shore', null);
  const list = fishFor(boat);
  return list.find(f => f.name === name) || list[0];
}

// ---------- Data loading ----------
// keepOld: same point, the data just went stale; the old data stays on screen until the new data arrives
S.reload = function (keepOld) {
  const token = ++S.token, spot = S.selected;
  if (!keepOld) {
    S.data = null; S.error = false; S.days = []; S.hourly = null; S.air = null; S.station = null; S.loadedAt = 0;
    render();
  }
  const ok = fn => v => { if (token === S.token) { fn(v); softRender(); } };
  const fail = fn => ok(() => { if (!keepOld) fn(); });
  const go = () => {
    loadSeaData(spot).then(ok(d => {
      // Weather did not arrive: retry in a couple of minutes, the sea stays on screen meanwhile
      if (!d.weatherOk) setTimeout(() => { if (token === S.token) S.reload(true); }, WEATHER_RETRY_MS);
      // Do not replace full data for the same point with incomplete data
      if (d.weatherOk || !keepOld || !S.data || !S.data.weatherOk) { S.data = d; S.loadedAt = Date.now(); }
    })).catch(fail(() => { S.error = true; }));
    loadDays(spot).then(ok(d => { S.days = d; })).catch(fail(() => { S.days = []; }));
    loadHourly(spot).then(ok(d => { S.hourly = d; })).catch(fail(() => { S.hourly = null; }));
    loadAir(spot).then(ok(d => { S.air = d; })).catch(fail(() => { S.air = null; }));
    loadStation(spot).then(ok(d => { S.station = d; })).catch(fail(() => { S.station = null; }));
  };
  if (spot.snap === false) {
    // region points are checked against the depth map and moved onto water if needed
    const key = 'snap.' + spot.lat.toFixed(4) + ',' + spot.lon.toFixed(4);
    const cached = Store.get(key, null);
    const apply = p => {
      if (p) { spot.lat = p.lat; spot.lon = p.lon; }
      spot.snap = true;
    };
    if (cached) { apply(cached); go(); return; }
    if (spot.shore) {
      // "Shore": load data right away and move the point in the background; if it moved, reload
      const la0 = spot.lat, lo0 = spot.lon;
      go();
      snapToWater(la0, lo0, true).then(p => {
        if (p) Store.set(key, p);
        apply(p);
        if (p && token === S.token && (Math.abs(p.lat - la0) > 0.0003 || Math.abs(p.lon - lo0) > 0.0003)) S.reload();
      }).catch(() => { spot.snap = true; });
      return;
    }
    snapToWater(spot.lat, spot.lon).then(p => {
      if (p) Store.set(key, p);
      apply(p);
      if (token === S.token) { render(); go(); }
    }).catch(() => { spot.snap = true; if (token === S.token) go(); });
    return;
  }
  go();
};

// Came back to the page and the data is older than half an hour: refresh. Events arrive in pairs, so no more than once a minute
function refreshIfStale() {
  const now = Date.now();
  if (document.hidden || S.picker || !S.loadedAt || now - S.loadedAt <= STALE_MS || now - S.staleTry < 60000) return;
  S.staleTry = now;
  S.reload(true);
}

// do not redraw under the user's hands while they are typing
function softRender() {
  const a = document.activeElement;
  if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && $('view').contains(a)) { S.pending = true; return; }
  render();
}

// ---------- Rendering ----------
function render(force) {
  const view = $('view'), nav = $('tabs');
  document.body.classList.toggle('picking', S.picker);
  if (S.picker) {
    if (MapUI.map || MapUI.box) MapUI.destroy();
    view.classList.remove('maponly');
    view.replaceChildren(h('div', { class: 'stack page-wrap' }, renderCountryPicker(S, A)));
    nav.replaceChildren();
    view.scrollTop = 0;
    lastTab = 'picker';
    return;
  }
  if (!force && S.tab === 3 && !S.showSettings && MapUI.alive()) { MapUI.ready(S); return; }
  const sameScreen = lastTab === (S.showSettings ? 'settings' : S.tab);
  const scroll = sameScreen ? view.scrollTop : 0;
  if (MapUI.map || MapUI.box) MapUI.destroy();

  document.body.classList.toggle('in-settings', S.showSettings);
  Bg.hold(!S.showSettings && S.tab === 3);
  view.classList.toggle('maponly', !S.showSettings && S.tab === 3);
  let content;
  if (S.showSettings) content = renderSettings(S, A);
  else if (S.tab === 0) content = renderBite(S, A);
  else if (S.tab === 1) content = renderConditions(S, A);
  else if (S.tab === 2) content = renderDays(S, A);
  else if (S.tab === 3) content = [MapUI.build(S, mapHooks)];
  else if (S.tab === 4) content = renderDiary(S, A);
  else content = renderLibrary(S, () => render());
  view.replaceChildren(h('div', { class: 'stack page-wrap' }, content));
  if (S.tab === 3 && !S.showSettings) view.replaceChildren(content[0]);
  view.scrollTop = scroll;
  lastTab = S.showSettings ? 'settings' : S.tab;
  if (!sameScreen) Stats.screen(S.tab, S.showSettings);

  nav.replaceChildren(...tabTitles().map((title, i) =>
    h('button', {
      class: 'tab' + (S.tab === i ? ' on' : ''), type: 'button',
      onclick: () => {
        if (S.tab === i && !S.showSettings) return;
        S.tab = i;
        if (i !== 3) { S.mapFocus = null; S.pick = null; }
        if (i === 4) S.diarySub = S.diarySub === 2 ? 2 : S.diarySub;
        render(true);
      }
    }, h('span', { class: 'ti' }, TAB_ICONS[i]), h('span', { class: 'tl' }, title))));
  document.documentElement.lang = Lang.current;
}

// ---------- Pop-up hint: how to put the site on an iPhone as an app ----------
// An iPhone cannot install an app from a website, but a site can be added to the Home Screen:
// icon, full screen, works offline. Many people do not know this, so we show a banner at the top.
// iPhone/iPad only, and only if the site is not already opened from the icon. "Got it" hides it forever,
// "Later" for 7 days.
const HINT_LATER_MS = 7 * 86400000;
function iosInstallState() {
  const ua = navigator.userAgent;
  // iPadOS pretends to be a Mac; tell them apart by the touch screen
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!ios || standalone) return null;
  // in-app browsers (Telegram, Instagram, Facebook, Google) and other browsers cannot add to the Home Screen
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|YaBrowser|Instagram|FBAN|FBAV|Line\/|Telegram/.test(ua);
  return { safari };
}
function shareIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ih-ico'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return svg;
}
function showInstallHint() {
  const st = iosInstallState();
  if (!st || Store.get('hint_closed', false) || Date.now() < Store.get('hint_later', 0)) return;
  // wait while the country picker is open
  if (S.picker || S.showSettings) { setTimeout(showInstallHint, 3000); return; }
  if (document.querySelector('.ihint')) return;
  const close = forever => {
    if (forever) Store.set('hint_closed', true); else Store.set('hint_later', Date.now() + HINT_LATER_MS);
    box.classList.remove('on'); setTimeout(() => box.remove(), 250);
  };
  const step = (n, ...kids) => h('li', null, h('span', { class: 'ih-n' }, String(n)), h('span', null, ...kids));
  const box = h('div', { class: 'ihint', role: 'dialog', 'aria-live': 'polite' },
    h('div', { class: 'ih-card' },
      h('div', { class: 'row' },
        h('img', { class: 'ih-app', src: 'apple-touch-icon.png', alt: '' }),
        h('b', { class: 'grow' }, tr('Install the app on your iPhone', 'Instalirajte aplikaciju na iPhone')),
        h('button', { class: 'gear', type: 'button', 'aria-label': 'close', onclick: () => close(false) }, '×')),
      h('p', { class: 'small' }, tr('The site works as an app: an icon on your screen, full screen and the forecast offline. Free, takes a few seconds.',
        'Sajt radi kao aplikacija: ikona na ekranu, cijeli ekran i prognoza bez veze. Besplatno, traje nekoliko sekundi.')),
      st.safari ? null : h('p', { class: 'small err' }, tr('The site is not open in Safari right now. Open it in Safari: the ··· menu or the compass icon → “Open in Safari”.',
        'Sajt sada nije otvoren u Safariju. Otvorite ga u Safariju: meni ··· ili ikona kompasa → „Otvori u Safariju“.')),
      h('ol', { class: 'ih-steps' },
        step(1, tr('Tap “Share” in Safari', 'Dodirnite „Podijeli“ u Safariju'), ' ', shareIcon()),
        step(2, tr('Choose “Add to Home Screen”. If you cannot see it, scroll the list down.',
          'Izaberite „Dodaj na početni ekran“. Ako ga ne vidite, pomjerite listu nadolje.')),
        step(3, tr('Tap “Add” and open the app from the new icon.',
          'Dodirnite „Dodaj“ i otvarajte aplikaciju s nove ikone.'))),
      h('p', { class: 'small' }, tr('The diary in the icon and in Safari is stored separately, so keep it in the icon.',
        'Dnevnik u ikoni i u Safariju čuva se odvojeno, pa ga vodite u ikoni.')),
      h('div', { class: 'row ih-btns' },
        btn(tr('Later', 'Kasnije'), () => close(false), { flat: true }),
        btn(tr('Got it', 'Razumijem'), () => close(true), { primary: true }))));
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('on'));
}

// ---------- Service worker ----------
function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const flag = w => { S.waitingWorker = w; S.updateReady = true; render(); };
    if (reg.waiting && navigator.serviceWorker.controller) flag(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) flag(nw);
      });
    });
    // check for a new version on every open
    reg.update().catch(() => {});
  }).catch(() => {});
  // reload the page only on an update, not on the very first install
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}

// ---------- Startup ----------
function init() {
  Lang.load();
  S.theme = Math.min(2, Math.max(0, Store.get('theme', 0)));
  Bg.init();
  Stats.init();
  A.applyTheme();
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => A.applyTheme());

  // Links from country pages (en/croatia.html etc.): ?c=HR&r=Pula&lang=hr
  try {
    const qs = new URLSearchParams(location.search);
    const qc = qs.get('c');
    if (qc && COUNTRIES.some(x => x.code === qc)) {
      Country.set(qc);
      const qr = qs.get('r');
      const reg = COUNTRIES.find(x => x.code === qc).regions;
      Store.set('region', qr && reg.some(r => r.key === qr) ? qr : reg[0].key);
    }
    if (qs.get('lang') && !Store.get('lang', null)) Lang.set(qs.get('lang'));
    if (location.search) history.replaceState(null, '', location.pathname);
  } catch (e) { /* no parameters */ }
  const savedCountry = Country.saved();
  Country.apply(savedCountry || 'ME');
  refreshRegions();
  S.picker = !savedCountry;
  const region = Store.get('region', REGIONS[0].key);
  S.region = REGIONS.some(r => r.key === region) ? region : REGIONS[0].key;
  S.boat = !!Store.get('boat', false);
  S.fish = pickFish(S.boat);
  S.selected = regionSpots(S.region)[0];
  S.mySpots = Store.get('my_spots', []);
  const mk = Store.get('mark', null);
  if (mk && mk.date === nowLocal().date) { S.mark = mk.m; S.slider = mk.m; }
  S.draft = newDraft(S);
  setTimeout(showInstallHint, 4000);

  $('view').addEventListener('focusout', () => {
    if (S.pending) { S.pending = false; setTimeout(() => softRender(), 80); }
  });
  document.addEventListener('visibilitychange', refreshIfStale);
  window.addEventListener('focus', refreshIfStale);
  window.addEventListener('pageshow', refreshIfStale);
  render(true);
  if (!S.picker) S.reload();
  registerWorker();
}
document.addEventListener('DOMContentLoaded', init);
