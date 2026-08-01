const form = document.getElementById('rsvp-form');
const statusEl = document.getElementById('status');
const button = form.querySelector('button');

// The invitation arrives as a short token in the URL fragment: #<id><key>
//   <id>  first GUESTS.i chars — which block in guests.js to decode
//   <key> the rest            — seeds the XOR keystream; the only secret
// Decoding yields { k: <magic key>, d: <display line>, p: [people] }, so the
// guest list and the magic key are absent from the repo and, because a fragment
// is never sent to a server, absent from Pages logs and Referer headers too.
// Blocks are built by build_encrypted_guestlist.py (kept out of the repo).
function b64uBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// xmur3 + sfc32, mirrored bit-for-bit by the same functions in the builder.
// Deliberately not crypto.subtle: it is unavailable over file://, and the page
// has to work when opened straight from disk.
function xmur3(str) {
  let h = (1779033703 ^ str.length) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
  };
}

function sfc32(a, b, c, d) {
  return function () {
    let t = (a + b) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
}

function keystream(seed, stretch, n) {
  const seeder = xmur3(seed);
  const rnd = sfc32(seeder(), seeder(), seeder(), seeder());
  for (let i = 0; i < stretch; i++) rnd();
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 4) {
    const v = rnd();
    out[i] = (v >>> 24) & 255;
    if (i + 1 < n) out[i + 1] = (v >>> 16) & 255;
    if (i + 2 < n) out[i + 2] = (v >>> 8) & 255;
    if (i + 3 < n) out[i + 3] = v & 255;
  }
  return out;
}

function fnv16(bytes) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619) >>> 0;
  return (((h >>> 16) ^ h) & 0xffff) >>> 0;
}

// Returns the invite object, or null for any token that doesn't decode to a
// block whose checksum matches — a wrong key must fail, never show wrong names.
function decodeToken(tok) {
  const G = window.GUESTS;
  if (!G || !G.b || !/^[A-Za-z0-9_-]+$/.test(tok)) return null;
  const idLen = G.i || 4;
  const id = tok.slice(0, idLen);
  const key = tok.slice(idLen);
  const block = G.b[id];
  if (!key || !block) return null;
  const data = b64uBytes(block);
  const ks = keystream(id + ':' + key, G.s || 0, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  const sum = (out[0] << 8) | out[1];
  const len = (out[2] << 8) | out[3];
  if (len < 1 || 4 + len > out.length) return null;
  const body = out.subarray(4, 4 + len);
  if (fnv16(body) !== sum) return null;
  return JSON.parse(new TextDecoder().decode(body));
}

let invite = null;
try {
  const raw = location.hash.slice(1);
  if (raw) invite = decodeToken(decodeURIComponent(raw));
} catch (_) { invite = null; }

const peopleEl = document.querySelector('.people');
if (invite && invite.d && peopleEl) peopleEl.textContent = invite.d;

const people = (invite && Array.isArray(invite.p))
  ? invite.p.map((p) => String(p).trim()).filter(Boolean)
  : [];

// One row per invited person with an explicit Tak/Nie choice (nothing
// preselected — submit refuses until every person is marked).
// textContent only, never innerHTML.
const peopleFs = document.getElementById('people-fieldset');
const listEl = document.getElementById('people-list');
const personRows = [];
if (listEl) {
  people.forEach(function (name, i) {
    const row = document.createElement('div');
    row.className = 'person-row';
    const pname = document.createElement('span');
    pname.className = 'pname';
    pname.textContent = name;
    const choice = document.createElement('span');
    choice.className = 'pchoice';
    for (const val of ['yes', 'no']) {
      const label = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'person-' + i;
      r.value = val;
      label.append(r, val === 'yes' ? ' Tak' : ' Nie');
      choice.append(label);
    }
    row.append(pname, choice);
    listEl.append(row);
    personRows.push({ name: name, group: 'person-' + i, row: row });
  });
  if (!people.length) listEl.hidden = true;
}

// The plus-one free input is only offered to single-person invites
const allowExtra = people.length === 1;
const extraWrap = document.querySelector('.extra');
if (extraWrap && !allowExtra) extraWrap.hidden = true;

// Marking a person clears their "missing" highlight
form.addEventListener('change', () => {
  personRows.forEach((pr) => {
    if (form[pr.group].value) pr.row.classList.remove('missing');
  });
});

// Magic key rides inside the blob — sent with the RSVP and verified server-side.
// At least one invited person is equally required. Without either, don't accept
// entries at all.
const key = invite && invite.k ? String(invite.k) : null;
if (!key || !people.length) {
  button.disabled = true;
  setStatus('Ten link jest niepełny — użyj linku ze swojego zaproszenia.', true);
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'error' : '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // The wire format is one comma-delimited field, so names may not contain commas
  const extra = (allowExtra && form.extra ? form.extra.value : '').trim().replace(/,/g, ' ');

  // No usable invite blob → never submit (button is disabled at load too;
  // this guards against anyone re-enabling it).
  if (!key || !personRows.length) {
    setStatus('Ten link jest niepełny — użyj linku ze swojego zaproszenia.', true);
    return;
  }

  // Attendance is derived from the per-person marks: any „Tak” → yes,
  // everyone „Nie” → the whole party declines.
  // Every named person must be explicitly marked Tak or Nie.
  const unmarked = personRows.filter((pr) => !form[pr.group].value);
  personRows.forEach((pr) => pr.row.classList.toggle('missing', !form[pr.group].value));
  if (unmarked.length) {
    setStatus('Zaznacz „Tak” lub „Nie” przy każdej osobie.', true);
    return;
  }
  let selected = personRows.filter((pr) => form[pr.group].value === 'yes').map((pr) => pr.name);
  if (extra) selected.push(extra);
  let attending;
  if (selected.length) {
    attending = 'yes';
  } else {
    attending = 'no';
    selected = people; // record who the declining invite covered
  }

  button.disabled = true;
  setStatus('Wysyłanie…', false);

  const payload = {
    key,
    attending,
    people: selected.join(','),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(window.RSVP_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
      // CRITICAL: no headers option at all. A Content-Type header triggers a
      // CORS preflight that Apps Script cannot answer → request blocked.
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const out = await res.json();
    if (out.status === 'forbidden') {
      setStatus('Ten link jest nieprawidłowy — użyj linku ze swojego zaproszenia.', true);
      return;
    }
    if (out.status !== 'ok') throw new Error('status ' + out.status);

    // Confirmation rendered from Google's echo, not local form values —
    // that's what proves the round trip.
    const s = out.saved;
    const names = String(s.people || '').split(',').filter(Boolean);
    const div = document.createElement('div');
    div.className = 'confirm';
    const strong = document.createElement('strong');
    strong.textContent = 'Dziękujemy!';
    const p = document.createElement('p');
    p.textContent = s.attending === 'yes'
      ? `Zapisano odpowiedź: ${names.join(', ')} — do zobaczenia na weselu!`
      : 'Zapisano odpowiedź — będzie nam Was brakowało.';
    div.append(strong, p);
    form.replaceWith(div);
  } catch (_) {
    setStatus('Nie udało się zapisać — spróbuj ponownie.', true);
    button.disabled = false;
  } finally {
    clearTimeout(timeout);
  }
});

// Links are minted by build_encrypted_guestlist.py, which prints one per person.
