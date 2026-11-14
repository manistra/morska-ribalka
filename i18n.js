// Language and translations. tr(en, sr) picks the variant for the current language.
const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'sr', label: 'Srpski' },
  { code: 'hr', label: 'Hrvatski' },
  { code: 'it', label: 'Italiano' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'sq', label: 'Shqip' },
  { code: 'sl', label: 'Slovenščina' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'tr', label: 'Türkçe' }
];
// Dictionaries for the other languages: TRX[language][English string] = translation (trx-*.js files)
window.TRX = window.TRX || {};
const trFallback = (L, en, sr) => (L === 'hr' || L === 'bs' ? sr : en);

const Store = {
  get(key, def) {
    try {
      const v = localStorage.getItem('fishing.' + key);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set(key, value) {
    try { localStorage.setItem('fishing.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
};

const Lang = {
  current: 'en',
  load() {
    const saved = Store.get('lang', null);
    const phone = (navigator.language || 'en').slice(0, 2).toLowerCase();
    const known = LANGS.map(l => l.code);
    const guess = known.includes(phone) ? phone : (phone === 'bs' || phone === 'cnr' ? 'sr' : 'en');
    this.current = LANGS.some(l => l.code === saved) ? saved : guess;
  },
  // an unknown code (a country language with no translation) does not change the current language
  set(code) { if (!LANGS.some(l => l.code === code)) return; this.current = code; Store.set('lang', code); }
};

function tr(en, sr) {
  const L = Lang.current;
  if (L === 'en') return en;
  if (L === 'sr') return sr;
  const d = window.TRX[L];
  if (d && d[en]) return d[en];
  return trFallback(L, en, sr);
}
// translation with {0}, {1}… substitution from the vars array
function trv(en, sr, vars) {
  return tr(en, sr).replace(/\{(\d+)\}/g, (m, i) => (vars[+i] != null ? vars[+i] : m));
}
// array [en, sr] -> string in the current language
function t3(arr) {
  if (!arr) return '';
  const L = Lang.current;
  if (L === 'en') return arr[0];
  if (L === 'sr') return arr[1] != null ? arr[1] : arr[0];
  const d = window.TRX[L];
  if (d && d[arr[0]]) return d[arr[0]];
  const v = L === 'hr' ? arr[1] : arr[0];
  return v != null ? v : arr[0];
}

const noData = () => tr('no data', 'nema podataka');
const U = {
  m: () => tr('m', 'm'),
  ms: 'ms',            // internal flag: wind is stored in m/s, displayed in km/h
  hpa: () => tr('hPa', 'hPa'),
  kmh: () => tr('km/h', 'km/h'),
  cm: () => tr('cm', 'cm'),
  mm: () => tr('mm', 'mm')
};

function regionLabel(key) {
  for (const c of COUNTRIES) {
    const r = c.regions.find(x => x.key === key);
    if (r) {
      if (Lang.current === c.lang || (c.lang === 'hr' && Lang.current === 'sr')) return r.loc;
      // for German the dictionary has its own names (Neapel, Korfu, Triest)
      const d = window.TRX[Lang.current];
      return (d && d[r.en]) || r.en;
    }
  }
  return key;
}

function spotLabel(name) {
  if (name.includes(' · ')) {
    const base = name.split(' · ')[0];
    const region = name.split(' · ').slice(1).join(' · ');
    return spotLabel(base) + ' · ' + regionLabel(region);
  }
  switch (name) {
    case 'Shore': return tr('Shore', 'Obala');
    case '3 km': return tr('3 km', '3 km');
    case '15 km': return tr('15 km', '15 km');
    case 'My location': return tr('My location', 'Moja lokacija');
    case 'Map point': return tr('Map point', 'Tačka na karti');
    default: return name;
  }
}

// Species names in the interface language: the main one first, then common ones. None for en (the key is the English name).
function fishNames(key) {
  const n = window.SITE_DATA && SITE_DATA.names[key];
  return n ? n[Lang.current] : null;
}

function fishLabel(name) {
  const names = fishNames(name);
  if (names && names.length) return names[0];
  const l = DATA.fishLabels[name];
  return l ? t3(l) : name;
}

// ---------- formatting ----------
const isNaN_ = v => v == null || Number.isNaN(v);
const f1 = v => v.toFixed(1);
const f0 = v => v.toFixed(0);
const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

// Wind is always in m/s internally, km/h on screen
function fmt(value, unit) {
  if (isNaN_(value)) return noData();
  if (unit === U.ms) return f0(value * 3.6) + ' ' + U.kmh();
  return f1(value) + ' ' + unit;
}

function withNorm(value, unit, low, high, digits) {
  if (isNaN_(value)) return noData();
  const wind = unit === U.ms;
  const k = wind ? 3.6 : 1;
  const shown = wind ? U.kmh() : unit;
  const d = wind ? 0 : digits;
  const status = value < low ? tr('below normal', 'ispod normale')
    : value > high ? tr('above normal', 'iznad normale')
      : tr('normal', 'u normali');
  const usual = tr('usually', 'obično');
  return `${(value * k).toFixed(d)} ${shown} (${usual} ${(low * k).toFixed(d)}–${(high * k).toFixed(d)}, ${status})`;
}

// pick a variant from an {en,sr,...} object with a fallback
const byLang = o => o[Lang.current] || (Lang.current === 'hr' ? o.sr : o.en);

function compass(deg) {
  if (isNaN_(deg)) return '';
  const names = {
    en: ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'],
    sr: ['sjever', 'sjeveroistok', 'istok', 'jugoistok', 'jug', 'jugozapad', 'zapad', 'sjeverozapad'],
    it: ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'],
    el: ['βορράς', 'βορειοανατολικά', 'ανατολή', 'νοτιοανατολικά', 'νότος', 'νοτιοδυτικά', 'δύση', 'βορειοδυτικά'],
    sq: ['veri', 'verilindje', 'lindje', 'juglindje', 'jug', 'jugperëndim', 'perëndim', 'veriperëndim'],
    sl: ['sever', 'severovzhod', 'vzhod', 'jugovzhod', 'jug', 'jugozahod', 'zahod', 'severozahod'],
    de: ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'],
    es: ['norte', 'nordeste', 'este', 'sudeste', 'sur', 'suroeste', 'oeste', 'noroeste'],
    tr: ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı']
  };
  return byLang(names)[Math.floor((deg + 22.5) / 45) % 8];
}

function windFrom(deg) {
  if (isNaN_(deg)) return '';
  const names = {
    en: ['N', 'NE (bora)', 'E', 'SE (jugo)', 'S', 'SW', 'W', 'NW'],
    sr: ['S', 'SI (bura)', 'I', 'JI (jugo)', 'J', 'JZ', 'Z', 'SZ'],
    it: ['N', 'NE (bora)', 'E', 'SE (scirocco)', 'S', 'SO', 'O', 'NO'],
    el: ['Β', 'ΒΑ (μπόρα)', 'Α', 'ΝΑ (σιρόκος)', 'Ν', 'ΝΔ', 'Δ', 'ΒΔ'],
    sq: ['V', 'VL (bora)', 'L', 'JL (siroko)', 'J', 'JP', 'P', 'VP'],
    sl: ['S', 'SV (burja)', 'V', 'JV (jugo)', 'J', 'JZ', 'Z', 'SZ'],
    de: ['N', 'NO (Bora)', 'O', 'SO (Jugo)', 'S', 'SW', 'W', 'NW'],
    es: ['N', 'NE (gregal)', 'E', 'SE (siroco)', 'S', 'SO', 'O', 'NO'],
    tr: ['K', 'KD (poyraz)', 'D', 'GD (keşişleme)', 'G', 'GB', 'B', 'KB']
  };
  return byLang(names)[Math.floor((deg + 22.5) / 45) % 8];
}

function beaufort(ms) {
  if (isNaN_(ms)) return -1;
  const k = ms * 3.6;
  const lim = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  for (let i = 0; i < lim.length; i++) if (k < lim[i]) return i;
  return 12;
}

function windWord(ms) {
  const b = beaufort(ms);
  if (b < 0) return noData();
  const en = ['calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze', 'fresh breeze', 'strong breeze', 'near gale', 'gale', 'strong gale', 'storm', 'violent storm', 'hurricane'];
  const sr = ['bonaca', 'lahor', 'povjetarac', 'slab vjetar', 'umjeren vjetar', 'umjereno jak vjetar', 'jak vjetar', 'žestok vjetar', 'olujni vjetar', 'jak olujni vjetar', 'oluja', 'jaka oluja', 'orkan'];
  const it = ['calma', 'bava di vento', 'brezza leggera', 'brezza tesa', 'vento moderato', 'vento teso', 'vento forte', 'vento molto forte', 'burrasca', 'burrasca forte', 'tempesta', 'tempesta violenta', 'uragano'];
  const el = ['άπνοια', 'ελαφρύ αεράκι', 'ελαφρά αύρα', 'μέτρια αύρα', 'μέτριος άνεμος', 'ισχυρή αύρα', 'ισχυρός άνεμος', 'σφοδρός άνεμος', 'θύελλα', 'ισχυρή θύελλα', 'καταιγίδα', 'σφοδρή καταιγίδα', 'τυφώνας'];
  const sq = ['qetësi', 'erë shumë e lehtë', 'erë e lehtë', 'erë e butë', 'erë e moderuar', 'erë e freskët', 'erë e fortë', 'erë shumë e fortë', 'stuhi', 'stuhi e fortë', 'furtunë', 'furtunë e dhunshme', 'uragan'];
  const sl = ['brezvetrje', 'rahel veter', 'lahen veter', 'šibek veter', 'zmeren veter', 'svež veter', 'močan veter', 'zelo močan veter', 'vihar', 'močan vihar', 'nevihta', 'silovita nevihta', 'orkan'];
  const de = ['Windstille', 'leiser Zug', 'leichte Brise', 'schwache Brise', 'mäßige Brise', 'frische Brise', 'starker Wind', 'steifer Wind', 'stürmischer Wind', 'Sturm', 'schwerer Sturm', 'orkanartiger Sturm', 'Orkan'];
  const es = ['calma', 'ventolina', 'flojito', 'flojo', 'bonancible', 'fresquito', 'fresco', 'frescachón', 'temporal', 'temporal fuerte', 'temporal duro', 'temporal muy duro', 'temporal huracanado'];
  const trw = ['sakin', 'esinti', 'hafif rüzgâr', 'zayıf rüzgâr', 'orta rüzgâr', 'sert rüzgâr', 'kuvvetli rüzgâr', 'fırtınamsı', 'fırtına', 'kuvvetli fırtına', 'tam fırtına', 'şiddetli fırtına', 'kasırga'];
  const word = byLang({ en, sr, it, el, sq, sl, de, es, tr: trw })[b];
  return `${word}, ${b} ${tr('Bft', 'Bf')}`;
}

// ---------- time in Montenegro (as in the weather requests) ----------
function nowLocal(atMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(atMs ? new Date(atMs) : new Date());
  const g = t => parts.find(p => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: parseInt(g('hour'), 10), minute: parseInt(g('minute'), 10) };
}

// Weekdays from our own table, starting with Monday. They used to come from the browser, and where Albanian is missing
// the system language was substituted for it (e.g. wrong abbreviations like "pt 06.11").
const WEEKDAYS = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  sr: ['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned'],
  hr: ['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned'],
  it: ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'],
  el: ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'],
  sq: ['Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht', 'Die'],
  sl: ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'],
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  es: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
  tr: ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
};
function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;   // 0 = Monday
  const w = (WEEKDAYS[Lang.current] || WEEKDAYS.en)[dow];
  return `${w} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}
