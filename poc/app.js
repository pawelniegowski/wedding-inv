const form = document.getElementById('rsvp-form');
const statusEl = document.getElementById('status');
const button = form.querySelector('button');

// Prefill name from ?g= — value only, never innerHTML
const params = new URLSearchParams(location.search);
const g = params.get('g');
if (g) form.name.value = g;

// Magic key from ?k= — sent with the RSVP and verified server-side.
// Without it, don't accept entries at all.
const key = params.get('k');
if (!key) {
  button.disabled = true;
  setStatus('This link is incomplete — please use the link from your invitation.', true);
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = isError ? 'error' : '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  button.disabled = true;
  setStatus('Sending…', false);

  const payload = {
    key,
    name: form.name.value.trim(),
    attending: form.attending.value, // "yes" | "no"
    guests: Number(form.guests.value) || 1,
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
      setStatus('This link isn’t valid — please use the link from your invitation.', true);
      return;
    }
    if (out.status !== 'ok') throw new Error('status ' + out.status);

    // Confirmation rendered from Google's echo, not local form values —
    // that's what proves the round trip.
    const s = out.saved;
    const p = document.createElement('p');
    p.textContent = `Saved ✓ — ${s.name}, attending: ${s.attending}, ` +
      `guests: ${s.guests}, at ${s.timestamp}`;
    form.replaceWith(p);
  } catch (_) {
    setStatus('Failed to save — try again.', true);
    button.disabled = false;
  } finally {
    clearTimeout(timeout);
  }
});
