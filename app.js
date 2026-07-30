const form = document.getElementById('rsvp-form');
const statusEl = document.getElementById('status');
const button = form.querySelector('button');

// The whole invitation is one base64url-encoded UTF-8 JSON blob in the URL
// fragment:  index.html#<blob>
//   { "k": "<magic key>",                           // verified server-side
//     "d": "Ewy i Arkadiusza Niegowskich",          // display string (genitive)
//     "p": ["Ewa Niegowska", "Arkadiusz Niegowski"] // invited people
//   }
// A fragment is never sent to the host, so the invite stays out of server logs
// and Referer headers — unlike the ?k=&i= query pair this replaces.
function b64uDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function readInvite() {
  const raw = location.hash.slice(1);
  if (raw) return JSON.parse(b64uDecode(decodeURIComponent(raw)));
  // Links minted before the switch: ?k=<key>&i=<blob without k>
  const q = new URLSearchParams(location.search);
  if (!q.get('i')) return null;
  const legacy = JSON.parse(b64uDecode(q.get('i')));
  if (!legacy.k) legacy.k = q.get('k');
  return legacy;
}

let invite = null;
try {
  invite = readInvite();
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

// Dev helper — run in the console to mint invite links:
//   makeInviteLink('Ewy i Arkadiusza Niegowskich', ['Ewa Niegowska','Arkadiusz Niegowski'], 'tajnyklucz')
window.makeInviteLink = function (display, peopleArr, k) {
  const json = JSON.stringify({ k: k || key || '', d: display, p: peopleArr });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#${b64}`;
};
