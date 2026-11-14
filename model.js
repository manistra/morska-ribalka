// Calculations: bite, visibility, bad weather, moon. An exact port of the formulas from the Android app.

// ---------- Moon ----------
function moonAgeAtMs(ms) {
  const newMoonRef = 947182440000;
  const synodic = 29.530588853;
  const days = (ms - newMoonRef) / 86400000;
  const age = days % synodic;
  return age < 0 ? age + synodic : age;
}

// daysAhead: how many days ahead to calculate (0 = now)
function moonAge(daysAhead = 0) {
  return moonAgeAtMs(Date.now() + daysAhead * 86400000);
}

function moonPhaseName(age) {
  if (age < 1.5 || age >= 28.0) return tr('New moon', 'Mlad mjesec');
  if (age < 6.4) return tr('Waxing crescent', 'Rastući srp');
  if (age < 8.4) return tr('First quarter', 'Prva četvrt');
  if (age < 13.8) return tr('Waxing gibbous', 'Mjesec raste');
  if (age < 15.8) return tr('Full moon', 'Pun mjesec');
  if (age < 21.1) return tr('Waning gibbous', 'Mjesec opada');
  if (age < 23.1) return tr('Last quarter', 'Posljednja četvrt');
  return tr('Waning crescent', 'Opadajući srp');
}

// ---------- Underwater visibility ----------
function clarityScore(d) {
  let score = 9.0;
  const wave = isNaN_(d.waveHeight) ? 0.5 : d.waveHeight;
  score -= wave > 1.2 ? 4.0 : wave > 0.7 ? 2.5 : wave > 0.3 ? 1.0 : 0.0;
  const wind = isNaN_(d.wind) ? 4.0 : d.wind;
  score -= wind > 9 ? 1.5 : wind > 6 ? 0.5 : 0.0;
  score -= d.rain3d > 30 ? 3.0 : d.rain3d > 10 ? 2.0 : d.rain3d > 2 ? 1.0 : 0.0;
  return Math.min(10, Math.max(1, Math.trunc(score)));
}
const visibilityMeters = score => Math.round(2 + (score - 1) * 2.5);
function clarityLabel(score) {
  if (score >= 8) return tr('very clear', 'veoma bistra');
  if (score >= 6) return tr('good', 'dobra');
  if (score >= 4) return tr('average', 'srednja');
  return tr('murky', 'mutna');
}

function trendLabel(t) {
  if (isNaN_(t)) return noData();
  const word = t < -2.0 ? tr('falling fast', 'brzo pada')
    : t < -0.5 ? tr('falling slowly', 'sporo pada')
      : t <= 0.5 ? tr('steady', 'stabilan')
        : t <= 2.0 ? tr('rising slowly', 'sporo raste')
          : tr('rising fast', 'brzo raste');
  return `${word} (${sgn(t, 1)} ${U.hpa()} ${tr('per 3 h', 'za 3 h')})`;
}

// ---------- Bite model ----------
function interp(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    if (x <= x2) return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
  }
  return pts[pts.length - 1][1];
}

// Pressure: studies show a weak effect, so the weight is small
const trendAdjPts = [[-8, 0], [-6, 0.3], [-3.4, 0.9], [-1.5, 0.6], [-0.5, 0.2], [0, 0], [1, -0.25], [3, -0.7], [6, -1.1]];
// Wind and waves are more about comfort and safety than about the bite: fish bite in wind and in waves. The weight is mild.
const windAdjPts = [[0, -0.2], [2, 0.2], [4, 0.3], [7, 0], [10, -0.5], [13, -1.2], [16, -2.0]];
const waveAdjPts = [[0, 0.2], [0.3, 0.2], [0.6, 0], [1.0, -0.3], [1.5, -0.8], [2.5, -1.8]];
const surfWindAdjPts = [[0, -0.8], [3, -0.2], [6, 0.6], [9, 1.0], [11, 0.6], [13, 0], [16, -1.5]];
const surfWaveAdjPts = [[0, -0.5], [0.3, 0.0], [0.6, 0.5], [1.0, 0.8], [1.5, 0.5], [2.0, -0.3], [3.0, -2.0]];
const cloudAdjPts = [[0, -0.3], [30, 0.0], [60, 0.4], [90, 0.6], [100, 0.6]];
const rainAdjPts = [[0, 0], [2, 0.1], [8, 0.0], [20, -0.8], [40, -2.0], [60, -3.0]];
const tempChangeAdjPts = [[-3, -1.5], [-1.5, -0.8], [-0.5, -0.1], [0, 0], [1, 0.2], [2.5, 0.1], [4, -0.5]];

// date: 'YYYY-MM-DD'
function seasonValue(fish, date) {
  const [y, mo, d] = date.split('-').map(Number);
  const m = mo - 1;
  const len = new Date(y, mo, 0).getDate();
  const pos = (d - 1) / len;
  const cur = fish.season[m];
  if (pos < 0.5) {
    const prev = fish.season[(m + 11) % 12];
    return cur + (prev - cur) * (0.5 - pos);
  }
  const next = fish.season[(m + 1) % 12];
  return cur + (next - cur) * (pos - 0.5);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// p: { fish, boat, date, waterTemp, tempChange, pressureHpa, trend3h, windMs, gustMs, waveM, cloudPct, rainMm, thunder, moonDays }
function biteModel(p) {
  const seasonF = clamp(seasonValue(p.fish, p.date) / 10.0, 0, 1);
  const tempF = isNaN_(p.waterTemp) ? 0.85 : clamp(interp(p.waterTemp, p.fish.tempPts), 0, 1);
  const presence = Math.sqrt(seasonF * tempF);
  const base = 1.5 + 6.0 * presence;
  const adj = [];

  let pAdj = isNaN_(p.trend3h) ? 0.0 : interp(p.trend3h, trendAdjPts);
  if (!isNaN_(p.pressureHpa)) {
    if (p.pressureHpa > 1025.0 && !isNaN_(p.cloudPct) && p.cloudPct < 30.0) pAdj -= 0.7;
    else if (p.pressureHpa < 1000.0) pAdj -= 0.3;
  }
  adj.push([tr('Pressure and trend', 'Pritisak i trend'), pAdj]);

  const surf = p.fish.surf && !p.boat;
  const windRaw = isNaN_(p.windMs) ? 4.0 : p.windMs;
  const windEff0 = isNaN_(p.gustMs) ? windRaw : Math.max(windRaw, p.gustMs * 0.55);
  const windEff = p.boat ? windEff0 * 1.15 : windEff0;
  adj.push([tr('Wind', 'Vjetar'), interp(windEff, surf ? surfWindAdjPts : windAdjPts)]);

  const waveRaw = isNaN_(p.waveM) ? 0.5 : p.waveM;
  const waveEff = p.boat ? waveRaw * 1.2 : waveRaw;
  adj.push([tr('Waves', 'Talasi'), interp(waveEff, surf ? surfWaveAdjPts : waveAdjPts)]);

  adj.push([tr('Cloud cover', 'Oblačnost'), isNaN_(p.cloudPct) ? 0.0 : interp(p.cloudPct, cloudAdjPts)]);

  let rAdj = isNaN_(p.rainMm) ? 0.0 : interp(p.rainMm, rainAdjPts);
  if (p.thunder) rAdj -= 2.5;
  adj.push([tr('Rain and thunderstorm', 'Padavine i grmljavina'), rAdj]);

  adj.push([tr('Water temperature change', 'Promjena temperature vode'),
    isNaN_(p.tempChange) ? 0.0 : interp(p.tempChange, tempChangeAdjPts)]);

  const half = 29.530588853 / 2.0;
  const m = p.moonDays % half;
  const d = Math.min(m, half - m);
  adj.push([tr('Moon', 'Mjesec'), 0.3 - 0.5 * (d / (half / 2.0))]);

  const score = clamp(base + adj.reduce((s, a) => s + a[1], 0), 1.0, 10.0);
  return { score, base, adjustments: adj };
}

// ms: the moment to evaluate, now by default
function biteExplain(data, fish, boat, ms) {
  const now = nowLocal(ms);
  const r = biteModel({
    fish, boat, date: now.date,
    waterTemp: data.waterTemp, tempChange: NaN,
    pressureHpa: data.pressure, trend3h: data.pressureTrend,
    windMs: data.wind, gustMs: data.gust, waveM: data.waveHeight,
    cloudPct: data.cloud, rainMm: data.rainNow * 3.0, thunder: false, moonDays: moonAgeAtMs(ms || Date.now())
  });
  // time of day counts in the "now" estimate too (it used to be only in the hourly chart)
  const tod = timeOfDayAdj(now.hour, data.sunrise, data.sunset, data.cloud);
  r.adjustments.push([tr('Time of day', 'Doba dana'), tod]);
  r.score = clamp(r.score + tod, 1.0, 10.0);
  return r;
}

// ---------- Conditions for the angler (comfort and safety, not the bite) ----------
// A separate 1–10 scale: 10 means all calm. The bite does not depend on it: fish bite in the rain, but standing in a downpour and gusts is hard.
const comfWindPts = [[0, 0], [3, 0], [5, -0.8], [7, -2.3], [9, -3.5], [11, -5.0], [12, -6.2], [14, -7.0], [17, -8.0]];
// From the shore waves interfere sooner: on rocks individual waves are 1.5–2 times higher than the average (Hs) and splash over.
// From a boat the height is multiplied by 1.4 and follows its own curve.
const comfWaveShorePts = [[0, 0], [0.3, 0], [0.5, -1.0], [0.8, -2.2], [1.0, -3.0], [1.5, -4.2], [2.0, -5.0], [3.0, -7.0]];
const comfWaveBoatPts = [[0, 0], [0.6, 0], [1.0, -0.8], [1.5, -2.0], [2.0, -3.0], [3.0, -5.0], [4.0, -7.0]];
const comfRainDayPts = [[0, 0], [2, -0.3], [5, -1.0], [10, -2.0], [20, -3.5], [40, -5.0], [60, -6.0]];
const comfRainOutingPts = [[0, 0], [0.5, -0.4], [1, -0.8], [3, -2.2], [6, -3.5], [10, -4.5], [20, -6.0], [30, -7.0]];
const comfRainPeakPts = [[0, 0], [1, -0.4], [2.5, -1.2], [4, -2.2], [7.6, -3.8], [10, -5.0]];
const comfTempPts = [[-5, -4.0], [0, -3.0], [5, -1.5], [10, -0.5], [14, 0], [31, 0], [35, -1.0], [39, -2.5]];

// Mean wave height (Hs) and how large individual waves get: up to about 1.8 Hs
// "(models 50–95)" if the lowest and highest models differ by at least minGap; otherwise empty
function spreadText(r, k, minGap) {
  if (!r || Number.isNaN(r[0]) || Number.isNaN(r[1])) return '';
  const lo = r[0] * k, hi = r[1] * k;
  if (hi - lo < minGap) return '';
  return ' ' + trv('(models {0}–{1})', '(modeli {0}–{1})', [f0(lo), f0(hi)]);
}
function waveHint(wave) {
  return isNaN_(wave) || wave < 0.2 ? null : trv('single waves up to {0}', 'pojedinačni do {0}', [fmt(wave * 1.8, U.m())]);
}
function waveText(wave) {
  return isNaN_(wave) || wave < 0.2 ? fmt(wave, U.m())
    : trv('{0}, single waves up to {1}', '{0}, pojedinačni do {1}', [fmt(wave, U.m()), fmt(wave * 1.8, U.m())]);
}

// p: { windMs, gustMs, waveM, rainMm, rainPeakMmH, thunder, snow, feelsC, boat, rainOuting }
// rainOuting: rainMm is the sum for a 3-hour outing, not for the day
function comfortModel(p) {
  const items = [];
  let cap = 10;
  const w = isNaN_(p.windMs) ? 0 : p.windMs, g = isNaN_(p.gustMs) ? 0 : p.gustMs;
  const wp = interp(Math.max(w, g * 0.8) * (p.boat ? 1.2 : 1), comfWindPts);
  if (wp < -0.05) items.push([tr('Wind', 'Vjetar'), trv('{0} km/h, gusts {1}', '{0} km/h, udari {1}', [f0(w * 3.6), f0(g * 3.6)]) + spreadText(p.gustRange, 3.6, 15), wp]);
  const wave = isNaN_(p.waveM) ? 0 : p.waveM;
  const vp = p.boat ? interp(wave * 1.4, comfWaveBoatPts) : interp(wave, comfWaveShorePts);
  if (vp < -0.05) items.push([tr('Waves', 'Talasi'), waveText(wave), vp]);
  const rain = isNaN_(p.rainMm) ? 0 : p.rainMm, peak = isNaN_(p.rainPeakMmH) ? 0 : p.rainPeakMmH;
  const rp = Math.min(interp(rain, p.rainOuting ? comfRainOutingPts : comfRainDayPts), interp(peak, comfRainPeakPts));
  if (rp < -0.05) items.push([tr('Rain', 'Kiša'), p.rainOuting
    ? trv('{0} mm in 3 h', '{0} mm za 3 h', [f1(rain)]) + spreadText(p.rainRange, 1, 3)
    : trv('{0} mm per day', '{0} mm za dan', [f0(rain)]), rp]);
  // Under noticeable rain it is never "Comfortable", even when there is no wind or waves
  if ((p.rainOuting && rain >= 1.0) || peak >= 2.5) cap = Math.min(cap, 7.5);
  if (p.thunder) { items.push([tr('Thunderstorm', 'Grmljavina'), tr('possible', 'moguća'), -6.0]); cap = Math.min(cap, 3.0); }
  if (p.snow) { items.push([tr('Snow', 'Snijeg'), tr('possible', 'moguć'), -4.0]); cap = Math.min(cap, 4.5); }
  if (!isNaN_(p.feelsC)) {
    const tp = interp(p.feelsC, comfTempPts);
    if (tp < -0.05) items.push([p.feelsC < 14 ? tr('Cold', 'Hladnoća') : tr('Heat', 'Vrućina'),
      trv('feels like {0} °C', 'osjeća se {0} °C', [f0(p.feelsC)]), tp]);
  }
  const score = Math.min(cap, clamp(10 + items.reduce((s, i) => s + i[2], 0), 1.0, 10.0));
  items.sort((a, b) => a[2] - b[2]);
  return { score, items };
}

// 0 green, 1 yellow, 2 orange, 3 red
function comfortLevel(score) { score = Math.round(score * 10) / 10; return score >= 8 ? 0 : score >= 6 ? 1 : score >= 4 ? 2 : 3; }
const COMFORT_COLORS = ['#2E9E5B', '#E0B000', '#F0841C', '#D9534F'];
// Row color by penalty strength: a minor penalty is not colored, otherwise it looks like an alarm
function penaltyColor(p) {
  if (p > -0.5) return null;
  return COMFORT_COLORS[p > -2 ? 1 : p >= -4 ? 2 : 3];
}
function comfortWord(level) {
  return [tr('Comfortable', 'Udobno'), tr('Tolerable', 'Podnošljivo'),
    tr('Unpleasant', 'Neugodno'), tr('Dangerous', 'Opasno')][level];
}

const OUTING_HOURS = 3;
const hourVal = (a, i) => { const v = a ? a[i] : null; return v == null || Number.isNaN(v) ? 0 : v; };

// Thunderstorm and snow by hourly weather codes; if there are no codes, use the daily values
function weatherFlags(raw, from, to, day) {
  const codes = [];
  for (let i = from; i <= to; i++) {
    const c = raw.code ? raw.code[i] : null;
    if (c != null && !Number.isNaN(c)) codes.push(c);
  }
  if (!codes.length) return { thunder: !!(day && day.thunder), snow: !!(day && day.snow) };
  return {
    thunder: codes.some(c => c >= 95 && c <= 99),
    snow: codes.some(c => (c >= 71 && c <= 77) || c === 85 || c === 86)
  };
}

// Conditions for an outing: the worst over 3 hours starting from the selected hour. What was earlier and what comes later does not affect the score.
// Open-Meteo reports precipitation at the end of the hour, so the first hour's rain sits at hourIndex + 1.
function comfortOuting(d, raw, hourIndex, day, air, boat) {
  const nz = v => (isNaN_(v) ? 0 : v);
  let wind = nz(d.wind), gust = nz(d.gust), wave = nz(d.waveHeight), rain = 0, peak = 0;
  for (let k = 0; k <= OUTING_HOURS; k++) {
    const i = hourIndex + k;
    wind = Math.max(wind, hourVal(raw.wind, i));
    gust = Math.max(gust, hourVal(raw.gust, i));
    wave = Math.max(wave, hourVal(raw.wave, i));
    if (k > 0) { const v = hourVal(raw.rain, i); rain += v; peak = Math.max(peak, v); }
  }
  const flags = weatherFlags(raw, hourIndex, hourIndex + OUTING_HOURS, day);
  // model spread over the same window: each model has its own gust maximum and its own rain total
  const range = v => { const x = v.filter(n => !Number.isNaN(n)); return x.length >= 3 ? [Math.min(...x), Math.max(...x)] : null; };
  const gustRange = range((raw.gustModels || []).map(a => { const v = []; for (let k = 0; k <= OUTING_HOURS; k++) { const n = a[hourIndex + k]; if (n != null && !Number.isNaN(n)) v.push(n); } return v.length ? Math.max(...v) : NaN; }));
  const rainRange = range((raw.rainModels || []).map(a => { let sum = 0; for (let k = 1; k <= OUTING_HOURS; k++) { const n = a[hourIndex + k]; if (n == null || Number.isNaN(n)) return NaN; sum += n; } return sum; }));
  return comfortModel({ gustRange, rainRange,
    windMs: wind, gustMs: gust, waveM: wave, rainMm: rain, rainPeakMmH: peak, rainOuting: true,
    thunder: flags.thunder, snow: flags.snow, feelsC: air && air.now ? air.now.feels : NaN, boat
  });
}

// Conditions while the hourly data has not loaded: the worst of the current values and the daily maxima
function comfortNow(d, today, air, boat) {
  const nz = v => (isNaN_(v) ? 0 : v);
  return comfortModel({
    windMs: Math.max(nz(d.wind), today ? nz(today.windMax) * 0.75 : 0),
    gustMs: Math.max(nz(d.gust), today ? nz(today.gustMax) : 0),
    waveM: Math.max(nz(d.waveHeight), today ? nz(today.waveMax) * 0.8 : 0),
    rainMm: today ? today.rain : NaN, rainPeakMmH: today ? today.rainPeakMmH : nz(d.rainNow),
    thunder: !!(today && today.thunder), snow: !!(today && today.snow),
    feelsC: air && air.now ? air.now.feels : NaN, boat
  });
}

// A short "what it is made of" list for the bite card: the base and the main adjustments
function biteTop(res) {
  const out = [[tr('Season and water', 'Sezona i voda'), f1(res.base), 0]];
  res.adjustments.filter(a => Math.abs(a[1]) >= 0.2).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4)
    .forEach(a => out.push([a[0], sgn(a[1], 1), a[1]]));
  return out;
}

// ---------- Bad weather warning ----------
// Returns null or [level (1 caution, 2 danger), text]; peakAt: when the peak is, for the 24-hour-ahead warning
function safetyWarning(windMax, gustMax, waveMax, rainMm, rainPeakMmH, thunder, boat, peakAt) {
  const wind = isNaN_(windMax) ? 0 : windMax;
  const gust = isNaN_(gustMax) ? 0 : gustMax;
  const wave = isNaN_(waveMax) ? 0 : waveMax;
  const rain = isNaN_(rainMm) ? 0 : rainMm;
  const peak = isNaN_(rainPeakMmH) ? 0 : rainPeakMmH;

  const windDanger = boat ? (wind >= 10.0 || gust >= 15.0) : gust >= 17.0;
  const windCaution = boat ? (wind >= 7.0 || gust >= 11.0) : (wind >= 8.0 || gust >= 11.0);
  const waveDanger = boat ? wave >= 1.5 : wave >= 2.0;
  const waveCaution = boat ? wave >= 1.0 : wave >= 1.2;
  const rainDanger = peak >= 10.0 || rain >= 40.0;
  const rainCaution = peak >= 4.0 || rain >= 10.0;

  const danger = windDanger || waveDanger || rainDanger || thunder;
  const caution = windCaution || waveCaution || rainCaution;
  if (!danger && !caution) return null;

  const reasons = [];
  if (thunder) reasons.push(tr('thunderstorm', 'grmljavina'));
  if (rainDanger) reasons.push(tr('downpour', 'pljusak'));
  else if (peak >= 4.0) reasons.push(tr('heavy rain', 'jaka kiša'));
  else if (rainCaution) reasons.push(tr('rain', 'kiša'));
  if (windDanger || windCaution) {
    reasons.push(boat ? tr('strong wind', 'jak vjetar') : tr('gusty wind', 'udarni vjetar'));
  }
  if (waveDanger || waveCaution) reasons.push(tr('high waves', 'visoki talasi'));

  const w = f0(wind * 3.6), g = f0(gust * 3.6), wv = f1(wave), r = f0(rain), p = f1(peak);
  const details = peakAt
    ? trv('Peak: {0}. Wind {1} km/h, gusts {2} km/h, waves {3} m, rain in 24 h {4} mm (up to {5} mm/h).', 'Vrhunac: {0}. Vjetar {1} km/h, udari {2} km/h, talasi {3} m, padavine za 24 h {4} mm (do {5} mm/h).', [peakAt, w, g, wv, r, p])
    : trv('Daily maximum: wind {0} km/h, gusts {1} km/h, waves {2} m, rain {3} mm (up to {4} mm/h).', 'Dnevni maksimum: vjetar {0} km/h, udari {1} km/h, talasi {2} m, padavine {3} mm (do {4} mm/h).', [w, g, wv, r, p]);
  const head = danger ? tr('⚠ Dangerous: ', '⚠ Opasno: ') : tr('⚠ Caution: ', '⚠ Oprez: ');
  return [danger ? 2 : 1, head + reasons.join(', ') + '. ' + details];
}

// Warning for 24 hours from the selected hour: with the day and time of the peak
function outlookWarning(raw, hourIndex, day, boat) {
  const end = Math.min(hourIndex + 24, raw.wind.length - 1);
  let wind = 0, gust = 0, gustI = hourIndex, wave = 0, waveI = hourIndex, rain = 0, peak = 0, peakI = hourIndex, thunderI = -1;
  for (let i = hourIndex; i <= end; i++) {
    wind = Math.max(wind, hourVal(raw.wind, i));
    if (hourVal(raw.gust, i) > gust) { gust = hourVal(raw.gust, i); gustI = i; }
    if (hourVal(raw.wave, i) > wave) { wave = hourVal(raw.wave, i); waveI = i; }
    if (i > hourIndex) {
      const v = hourVal(raw.rain, i);
      rain += v;
      if (v > peak) { peak = v; peakI = i - 1; }   // at the end of the hour, the rain itself an hour earlier
    }
    if (thunderI < 0 && raw.code && raw.code[i] >= 95 && raw.code[i] <= 99) thunderI = i;
  }
  const thunder = weatherFlags(raw, hourIndex, end, day).thunder;
  // take the peak time from the main cause of the warning
  const windLevel = safetyWarning(wind, gust, 0, 0, 0, false, boat);
  const waveLevel = safetyWarning(0, 0, wave, 0, 0, false, boat);
  const rainLevel = safetyWarning(0, 0, 0, rain, peak, false, boat);
  const levelOf = x => (x ? x[0] : 0);
  const top = Math.max(levelOf(windLevel), levelOf(waveLevel), levelOf(rainLevel));
  const at = thunderI >= 0 ? thunderI : levelOf(windLevel) === top ? gustI : levelOf(waveLevel) === top ? waveI : peakI;
  const peakAt = `${dayLabel(addDays(raw.date, Math.floor(at / 24)))}, ${pad2(at % 24)}:00`;
  return safetyWarning(wind, gust, wave, rain, peak, thunder, boat, peakAt);
}

// Precipitation for the selected day for the card: only the remaining hours, while rain running past midnight is shown to the end.
// Open-Meteo reports precipitation and probability at the end of the hour, so hour i is the raw.rain[i + 1] values.
function rainView(raw, dayIndex, fromHour, day) {
  const from = dayIndex * 24 + fromHour, dayEnd = (dayIndex + 1) * 24;
  let end = dayEnd;
  while (end < dayEnd + 12 && hourVal(raw.rain, end + 1) >= 0.2) end++;
  const windows = [];
  let start = -1, last = -1, sum = 0, wPeak = 0, rain = 0, peak = 0, prob = -1;
  const close = () => {
    if (start >= 0 && sum >= 0.5) windows.push({ fromHour: start - dayIndex * 24, toHour: last + 1 - dayIndex * 24, mm: sum, peakMmH: wPeak });
    start = -1; last = -1; sum = 0; wPeak = 0;
  };
  for (let i = from; i < end; i++) {
    const v = hourVal(raw.rain, i + 1);
    // the total and peak only for the day itself; the rain window may continue past midnight
    if (i < dayEnd) { rain += v; peak = Math.max(peak, v); }
    const pr = raw.prob ? raw.prob[i + 1] : null;
    if (pr != null && !Number.isNaN(pr)) prob = Math.max(prob, pr);
    if (v >= 0.2) {
      if (start < 0) start = i;
      last = i; sum += v; wPeak = Math.max(wPeak, v);
    } else if (start >= 0 && i - last > 1) close();
  }
  close();
  return Object.assign({}, day, {
    rain, rainPeakMmH: peak, rainWindows: windows, rainProbMax: prob,
    thunder: weatherFlags(raw, from, end, day).thunder
  });
}

// ---------- Best hours ----------
function hm(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function hmStr(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function bestHours(d) {
  const out = [];
  try {
    if (d.sunrise !== '—') {
      const t = hm(d.sunrise);
      out.push(`${tr('Dawn', 'Zora')}: ${hmStr(t - 30)} – ${hmStr(t + 90)}`);
    }
    if (d.sunset !== '—') {
      const t = hm(d.sunset);
      out.push(`${tr('Dusk', 'Sumrak')}: ${hmStr(t - 90)} – ${hmStr(t + 30)}`);
    }
  } catch (e) { /* skip */ }
  if (d.nextHigh !== '—') {
    out.push(trv('Tide change (high tide) around {0}', 'Promjena vode (plima) oko {0}', [d.nextHigh]));
  }
  if (d.nextLow !== '—') {
    out.push(trv('Tide change (low tide) around {0}', 'Promjena vode (oseka) oko {0}', [d.nextLow]));
  }
  return out;
}

// ---------- Hourly ----------
// Time of day: at dawn and dusk (morning and evening) fish are more active, in bright midday less so (studies and fishing sources agree on this;
// at night it depends on the species, so night is left alone). Dawn window: from half an hour before sunrise to an hour and a half after, mirrored in the evening.
function timeOfDayAdj(hour, sunrise, sunset, cloudPct) {
  const mid = hour + 0.5;
  const sr = sunrise && sunrise !== '—' ? hm(sunrise) / 60 : null;
  const ss = sunset && sunset !== '—' ? hm(sunset) / 60 : null;
  if (sr !== null && mid >= sr - 0.5 && mid <= sr + 1.5) return 1.2;
  if (ss !== null && mid >= ss - 1.5 && mid <= ss + 0.5) return 1.2;
  if (sr !== null && mid >= sr - 1.5 && mid <= sr + 2.5) return 0.5;
  if (ss !== null && mid >= ss - 2.5 && mid <= ss + 1.5) return 0.5;
  if (mid >= 11.0 && mid <= 16.0) {
    const c = isNaN_(cloudPct) ? 0.3 : clamp(cloudPct / 100, 0, 1);
    return -0.8 + 0.4 * c;   // clear midday -0.8, full overcast -0.4
  }
  return 0.0;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().substring(0, 10);
}

// The selected forecast time. Except for "Now" it is a 3-hour window [from, from + 3) (hours from midnight today),
// and the best hour for the bite inside the window is shown (hourIndex). Users did not understand "+3 h",
// so the buttons show an interval: "15:00–18:00", "Tomorrow 05:00–08:00". Morning starts at 5:00 (it used to be 7:00).
const SLOT_HOURS = 3, MORNING_HOUR = 5;
const hh = h => pad2(((h % 24) + 24) % 24) + ':00';
function forecastSlots(nowHour, raw, fish, boat) {
  const win = (from, label) => {
    const span = hh(from) + '–' + hh(from + SLOT_HOURS);
    let best = from, bestScore = -Infinity;
    if (raw) for (let h = from; h < from + SLOT_HOURS; h++) {
      const r = hourExplain(raw, fish, boat, h);
      if (r && r.score > bestScore) { bestScore = r.score; best = h; }
    }
    return { label: label(span), hourIndex: best, window: span };
  };
  return [
    { label: tr('Now', 'Sada'), hourIndex: nowHour },
    win(nowHour + SLOT_HOURS, s => s),
    win(nowHour + 2 * SLOT_HOURS, s => s),
    win(24 + MORNING_HOUR, s => trv('Tomorrow {0}', 'Sutra {0}', [s]))
  ];
}

// Estimate for a specific hour (hourIndex counts from midnight today), with an explanation
function hourExplain(raw, fish, boat, hourIndex) {
  if (hourIndex < 0 || hourIndex >= raw.wind.length) return null;
  const pNow = raw.pressure[hourIndex + 3] ?? NaN;
  const pBefore = raw.pressure[hourIndex] ?? NaN;
  const trend = (Number.isNaN(pNow) || Number.isNaN(pBefore)) ? NaN : pNow - pBefore;
  // precipitation: sum for the hour before and two hours after
  let rain = 0;
  for (let k = -1; k <= 2; k++) {
    const v = raw.rain[hourIndex + k];
    if (v != null && !Number.isNaN(v)) rain += v;
  }
  const dayIndex = Math.floor(hourIndex / 24);
  const r = biteModel({
    fish, boat, date: addDays(raw.date, dayIndex), waterTemp: raw.waterTemp[hourIndex], tempChange: NaN,
    pressureHpa: pNow, trend3h: trend, windMs: raw.wind[hourIndex], gustMs: raw.gust[hourIndex],
    waveM: raw.wave[hourIndex], cloudPct: raw.cloud[hourIndex], rainMm: rain, thunder: false, moonDays: moonAge(dayIndex)
  });
  const tod = timeOfDayAdj(hourIndex % 24, raw.sunrise[dayIndex], raw.sunset[dayIndex], raw.cloud[hourIndex]);
  r.adjustments.push([tr('Time of day', 'Doba dana'), tod]);
  r.score = clamp(r.score + tod, 1.0, 10.0);
  return r;
}

function hourlyScores(raw, fish, boat) {
  const res = [];
  for (let hour = 0; hour < 24; hour++) {
    const r = hourExplain(raw, fish, boat, hour);
    if (r) res.push({ hour, score: r.score });
  }
  return res;
}

// The same screen data, but wind, waves, pressure, water, precipitation, current and sea level are taken for the selected hour
function forecastAt(d, raw, hourIndex) {
  const pick = (a, old) => (isNaN_(a[hourIndex] ?? NaN) ? old : a[hourIndex]);
  const pNow = raw.pressure[hourIndex + 3] ?? NaN;
  const pBefore = raw.pressure[hourIndex] ?? NaN;
  const tide = tideAt(raw.seaLevel, raw.times, hourIndex);
  return Object.assign({}, d, {
    seaLevel: tide.level,
    tideRising: tide.rising,
    nextHigh: tide.high,
    nextLow: tide.low,
    currentSpeed: pick(raw.currentSpeed, d.currentSpeed),
    currentDir: pick(raw.currentDir, d.currentDir),
    wind: pick(raw.wind, d.wind),
    gust: pick(raw.gust, d.gust),
    waveHeight: pick(raw.wave, d.waveHeight),
    waterTemp: pick(raw.waterTemp, d.waterTemp),
    cloud: pick(raw.cloud, d.cloud),
    rainNow: pick(raw.rain, d.rainNow),
    pressure: Number.isNaN(pNow) ? d.pressure : pNow,
    pressureTrend: (Number.isNaN(pNow) || Number.isNaN(pBefore)) ? d.pressureTrend : pNow - pBefore
  });
}

// Average score for morning, day and evening of the selected day
function dayParts(raw, date, fish, boat) {
  const dayIndex = daysBetween(raw.date, date);
  if (dayIndex < 0 || dayIndex >= HOURLY_DAYS) return null;
  const avg = (from, to) => {
    const v = [];
    for (let h = from; h <= to; h++) {
      const r = hourExplain(raw, fish, boat, dayIndex * 24 + h);
      if (r) v.push(r.score);
    }
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
  };
  return { morning: avg(5, 10), day: avg(11, 16), evening: avg(17, 21) };
}

function bestWindow(points, fromHour) {
  let best = null;
  for (let h = fromHour; h < 23; h++) {
    const avg = (points[h].score + points[h + 1].score) / 2.0;
    if (best === null || avg > best[1]) best = [h, avg];
  }
  return best;
}

// ---------- Wind relative to the shore ----------
const SHORE_FACING_DEG = 225.0;
function windVsShore(windFromDeg, windMs) {
  if (isNaN_(windFromDeg)) return null;
  let diff = Math.abs(windFromDeg - SHORE_FACING_DEG) % 360.0;
  if (diff > 180.0) diff = 360.0 - diff;
  const strong = !isNaN_(windMs) && windMs * 3.6 >= 25.0;
  if (diff <= 50.0) {
    return [0, strong
      ? tr('From the sea, onto the shore: builds waves and surf', 'S mora, prema obali: stvara talas i prasak')
      : tr('From the sea, onto the shore: some chop and surf near the shore', 'S mora, prema obali: uz obalu može biti mreškanje i prasak')];
  }
  if (diff >= 130.0) {
    return [2, strong
      ? tr('Offshore, towards the sea: a boat can be pushed away from the coast, be careful', 'S kopna, prema moru: čamac može nositi od obale, budite oprezni')
      : tr('Offshore, towards the sea: calm near the shore, a boat can drift out', 'S kopna, prema moru: uz obalu je mirno, čamac može nositi na pučinu')];
  }
  return [1, tr('Along the shore', 'Duž obale')];
}

// ---------- Scores and colors ----------
function scoreColor(score) {
  // score rounded; the scale is strict: 5-7 is "average", "good" from 8
  if (score >= 9) return '#2E9E5B';
  if (score >= 8) return '#8BC34A';
  if (score >= 5) return '#F0A030';
  return '#D9534F';
}
function scoreWord(score) {
  if (score >= 9) return tr('excellent', 'odličan');
  if (score >= 8) return tr('good', 'dobar');
  if (score >= 5) return tr('fair', 'srednji');
  return tr('poor', 'slab');
}

// ---------- Fish for the calculation ----------
function buildFish(def) {
  return { name: def.name, season: def.season, tempPts: DATA.temps[def.temp], surf: def.surf };
}
const FISH = {
  shore: DATA.shore.map(buildFish),
  boat: DATA.boat.map(buildFish)
};
const fishFor = boat => (boat ? FISH.boat : FISH.shore).filter(f => Country.visible({ key: f.name }));

// ---------- Regions and points (taken from the current country) ----------
const SPOT_NAMES = ['Shore', '3 km', '15 km'];
function buildRegions() {
  return Country.regions().map((r, idx) => ({
    key: r.key,
    spots: r.pts.map((p, i) => ({ name: (idx === 0 ? '' : '') + SPOT_NAMES[i] + (idx === 0 ? '' : ' · ' + r.key), lat: p[0], lon: p[1], snap: false, shore: i === 0 }))
  }));
}
let REGIONS = buildRegions();
function refreshRegions() { REGIONS = buildRegions(); }
const regionSpots = key => (REGIONS.find(r => r.key === key) || REGIONS[0]).spots;

const WIND_LOW = 5 / 3.6, WIND_HIGH = 20 / 3.6;
const WAVE_LOW = 0.2, WAVE_HIGH = 0.8;
const PRESSURE_LOW = 1005, PRESSURE_HIGH = 1025;
