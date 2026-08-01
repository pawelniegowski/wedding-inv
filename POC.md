# PoC Spec — RSVP Flow (Static Page → Apps Script → Google Sheet)

Goal: prove the end-to-end flow with the smallest possible build before styling anything.
A dummy one-page site with an RSVP form POSTs to a Google Apps Script endpoint that
appends rows to a Google Sheet, and the page renders its confirmation from Google's echo.

**Definition of done:** operator submits the form from a phone that is *not* logged into
Google, sees "Saved ✓" with the echoed data, and the row is visible in the Sheet.

---

## 0. Division of labor

| Who | Does what |
|---|---|
| **Claude Code** | Builds all repo files (§2), injects values the operator provides |
| **Operator (human)** | Creates the Sheet, pastes the script into Google, clicks through the deploy UI (§4), then hands back two values: the **Sheet URL** and the **`/exec` web-app URL** |

Claude Code cannot click through Google's UI — §4 is manual, ~5 minutes. When the
operator provides the Sheet URL, extract the spreadsheet ID (the long token between
`/d/` and `/edit`) and inject it into `Code.gs`.

---

## 1. Scope

**In:** one ugly-but-functional HTML page, one form, URL-param name prefill (proves the
personalization mechanic), the CORS-safe POST, the Apps Script receiver, save + echo +
confirm round trip, error state.

**Out (deliberately):** design, countdown, map, honeypot, invite codes, email
notifications, localStorage, decline-path niceties. All after the flow is proven.

---

## 2. Files

````
./                  # repo root (moved out of poc/ once the flow was proven and themed)
├── index.html      # RSVP page — woodland theme, Polish
├── guests.js       # encrypted invitation blocks (generated; commit this)
├── app.js          # prefill, submit, confirm/error handling
├── config.js       # window.RSVP_ENDPOINT = '<PASTE /exec URL>';
└── Code.gs         # NOT served — copy-paste source for the Google side

uncommitted (see .git/info/exclude):
  build_encrypted_guestlist.py   guests.txt   invite_links.tsv
````

### 2.1 `index.html`

- Fields: **Name** (text, required), **Attending** (radio yes/no, required),
  **Guests** (number 1–6, default 1).
- `<div id="status">` under the button for Sending… / Saved / Error.
- Button: "Send RSVP".
- Viewport meta tag; inputs `font-size:16px` so iPhones don't zoom on focus.
  No other styling effort.

### 2.2 `app.js`

1. **Prefill:** `const g = new URLSearchParams(location.search).get('g');`
   If present, set the name input's `.value` (stays editable). Use `.value`/`textContent`
   only — never `innerHTML` with URL data.
2. **Submit handler:** prevent default, disable button, show "Sending…", then:

````js
const payload = {
  name: form.name.value.trim(),
  attending: form.attending.value,        // "yes" | "no"
  guests: Number(form.guests.value) || 1,
};

const res = await fetch(window.RSVP_ENDPOINT, {
  method: 'POST',
  body: JSON.stringify(payload),
  // CRITICAL: no headers option at all. Adding 'Content-Type: application/json'
  // triggers a CORS preflight that Apps Script cannot answer → request blocked.
  // Body travels as text/plain; the script JSON.parses it server-side.
});
const out = await res.json();             // readable because fetch follows the 302 redirect
````

3. **Confirm (the save-reread step):** the script responds with the row it actually
   wrote (§2.3). On success, replace the form with:
   `Saved ✓ — {name}, attending: {attending}, guests: {guests}, at {timestamp}` —
   rendered from the **response**, not local form values. That's what proves the data
   made the round trip to Google and back.
4. **Error:** thrown error / non-ok / `status !== 'ok'` → re-enable button, show
   "Failed to save — try again.", keep form values. Wrap fetch in an `AbortController`
   15 s timeout.

### 2.3 `Code.gs` (operator pastes into script.new)

````js
const SHEET_ID = '<INJECT: spreadsheet ID from operator-provided Sheet URL>';

function doPost(e) {
  let data = {};
  try { data = JSON.parse(e.postData.contents); } catch (_) {}

  const row = [
    new Date(),
    String(data.name ?? '').slice(0, 120),
    data.attending === 'yes' ? 'yes' : 'no',
    Math.min(parseInt(data.guests, 10) || 1, 6),
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    SpreadsheetApp.openById(SHEET_ID).getSheetByName('RSVPs').appendRow(row);
  } finally {
    lock.releaseLock();
  }

  // Echo back what was written — client renders its confirmation from this.
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    saved: { timestamp: row[0], name: row[1], attending: row[2], guests: row[3] },
  })).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'alive' }))
    .setMimeType(ContentService.MimeType.JSON);
}
````

---

## 3. The flow being proven

````
guest browser (github.io or local)        Google servers
──────────────────────────────────        ──────────────
form → JSON → fetch POST ───────────────▶ doPost: parse → append row to Sheet
                                          → respond {status:"ok", saved:{...}}
◀─────────────────────────────────────────
render "Saved ✓" from response.saved      row visible in Sheet
````

One round trip; confirmation text comes from Google's echo, not local state.

---

## 4. Operator runbook (manual, ~5 min, in order)

1. Create a Google Sheet → rename the first tab to **`RSVPs`** → row 1 headers:
   `timestamp | name | attending | guests`. Copy the Sheet URL → give to Claude Code.
2. Go to `script.new` → delete boilerplate → paste `Code.gs` (SHEET_ID injected) → save.
3. Run `doGet` once from the editor toolbar → authorization popup → your account →
   "unverified app" warning → **Advanced → Go to (project) → Allow**. (You're approving
   your own script; guests never see any of this.)
4. **Deploy → New deployment → ⚙ → Web app** →
   Execute as: **Me** · Who has access: **Anyone** (NOT "Anyone with a Google account") →
   Deploy → copy the URL ending in **`/exec`** → give to Claude Code for `config.js`.
5. Any later edit to `Code.gs`: **Deploy → Manage deployments → ✎ → Version: New →
   Deploy.** Without this, `/exec` serves old code forever. (The `/dev` URL always runs
   the latest code but only while logged in as you — fine for solo testing, useless
   for guests.)

---

## 5. Test checklist

- [ ] Incognito GET of `/exec` → `{"status":"alive"}`, **no Google login prompt**.
- [ ] `curl -L -d '{"key":"<magic-key>","attending":"yes","people":"CurlTest,Second Person"}' <exec-url>`
      → `status:"ok"` + `saved` echo → row appears in the Sheet.
      (Do **not** add `-X POST`: it forces POST onto Google's one-time redirect URL,
      which only accepts GET → HTML error page. `-d` alone already makes the first
      request a POST, and curl correctly downgrades to GET on the 302.)
- [ ] Same curl with a wrong/missing `key` → `{"status":"forbidden"}`, no row in Sheet.
- [ ] Open an `#<blob>` invite link (§5.5) → display line personalized, one Tak/Nie
      row per invited person, plus-one field only when a single person is invited.
- [ ] Open the page with no/garbage fragment → button disabled; force-enable it in
      the console and submit → **no request leaves the browser**.
- [ ] Submit from the page → "Saved ✓" shows Google-echoed values → row in Sheet.
- [ ] Submit from a **phone not logged into Google** → same result. ← the money test
- [ ] Temporarily break `RSVP_ENDPOINT` (typo one char) → error state shows, form values
      survive, button re-enables. Restore afterwards.
- [ ] Works when served from GitHub Pages (cross-origin). Note: `file://` usually works
      for this pattern but some browsers are stricter — if it fails locally, test via
      `python3 -m http.server` or the Pages URL before assuming the code is wrong.

---

## 5.5 Invite links: an 8-character encrypted token

The public repo means anyone crawling GitHub can find the page and the `/exec` URL,
so neither the guest list nor the magic key may appear in it. Each invitation is
stored in committed `guests.js` as an XOR-encrypted, base64url block; the link is

````
https://pawelniegowski.github.io/wedding-inv/#rOghHi9N
                                              └┬─┘└┬─┘
                        block id (public, a key in guests.js)  keystream seed (the secret)
````

Decrypting yields `{ k: <magic-key>, d: <display line>, p: [people] }`, which the
page uses for the personalized line, the per-person Tak/Nie rows, and the `key`
field in the POST. Apps Script compares `key` against the **`RSVP_KEY` Script
Property**; mismatch or unset → `{"status":"forbidden"}`, nothing written.

Blocks are padded to a common length, shuffled, and optionally mixed with decoys,
so the file leaks neither party sizes nor the guest count. A 4-byte header
(FNV-1a checksum + length) means a wrong key **fails** rather than rendering
garbage names. Keystream: `xmur3` seeding `sfc32`, with `GUESTS.s` discarded
warm-up rounds — mirrored bit-for-bit in `app.js` and the builder, and
deliberately not `crypto.subtle`, which is unavailable over `file://`.

Build with the **uncommitted** `build_encrypted_guestlist.py` (excluded via
`.git/info/exclude`, alongside `guests.txt` and `invite_links.tsv`):

````sh
python3 build_encrypted_guestlist.py --rsvp-key <key> --decoys 8   # add --key-chars 8 for real strength
````

It prints one link per person plus an `invite_links.tsv` for mail merge, and
rewrites `guests.js` — **commit `guests.js` together with any `app.js` change**,
or the deployed page can't decode links. Every re-run mints new keys, so all
previously sent links stop working.

**Honest security note.** A 4-character key is 24 bits: sweeping all candidates
against one block costs about 2 core-hours natively, seconds on a GPU. That hides
the list from anyone casually reading the repo; it does not withstand someone
determined. `--key-chars 8` (12-character links) pushes a sweep past a thousand
core-years. Guests pay one ~3 ms decode either way.

Without a decodable token the page disables the submit button **and** the submit
handler refuses — verified by force-re-enabling the button in the console. There is
no `?k=`/`?i=` fallback.

## 6. If the PoC passes → next (not now)

Fold in, roughly in order: real content + design pass, `n`/`c` URL params, honeypot,
email notification (`MailApp`), dietary/song/message fields, decline path, localStorage
revisit state, OG tags, `noindex`. All already specced in `wedding-invite-spec.md`.

## 7. Known failure modes → likely cause

| Symptom | Cause |
|---|---|
| Red CORS error in console | A `Content-Type`/custom header snuck into the fetch — remove all headers |
| Google login page instead of JSON | Deployed as "Anyone with a Google account" — redeploy as "Anyone" |
| Code changes have no effect | Forgot "Version: New" on redeploy (§4.5) |
| `{"status":"ok"}` but no row in Sheet | Wrong `SHEET_ID`, or tab not named exactly `RSVPs` |
| Works for you, fails for others | You're on the `/dev` URL — guests need `/exec` |
| `{"status":"forbidden"}` on every submit | `RSVP_KEY` Script Property unset/mistyped, `k` missing from the link's fragment blob, or key change not redeployed (§4.5) |
| Empty `people` column in the Sheet | Deployed `Code.gs` predates the `{key, attending, people}` payload — re-paste and redeploy with Version: New |
````
````

One note on your workflow: the order matters slightly — Claude Code can build everything except `config.js`'s real value before you touch Google, so a sensible sequence is: CC builds the files with a placeholder endpoint → you do runbook steps 1–4 → paste the two URLs back into the CC session → CC injects them → run the checklist. The "money test" is §5's phone-not-logged-into-Google submit; once that passes, the architecture question is settled and everything after is cosmetics.
