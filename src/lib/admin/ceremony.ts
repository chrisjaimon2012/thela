/**
 * The browser half of a passkey ceremony, as a string of JavaScript.
 *
 * This is the one place in thela that genuinely cannot work without scripting:
 * `navigator.credentials` has no form-post equivalent. Everything else — the
 * cart, checkout, marking an order paid — degrades to a plain form, and that is
 * a deliberate line. Here there is nothing to degrade to, so the page says so
 * plainly rather than silently doing nothing.
 *
 * Kept as a string rather than a client-side island because there is no
 * framework in this project and no bundler step for browser code. Thirty lines
 * inlined into two pages beats a build pipeline.
 */

export const CEREMONY_JS = `
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const unb64 = (s) => Uint8Array.from(
  atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));

function fail(msg) {
  const box = document.getElementById('ceremony-error');
  box.textContent = msg;
  box.hidden = false;
  document.querySelectorAll('button[type=submit]').forEach(b => { b.disabled = false; });
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

async function register(form) {
  const options = await post('/admin/api/register/start', {
    email: form.email.value, name: form.name.value,
  });

  const created = await navigator.credentials.create({
    publicKey: {
      ...options.publicKey,
      challenge: unb64(options.publicKey.challenge),
      user: { ...options.publicKey.user, id: unb64(options.publicKey.user.id) },
    },
  });

  // getPublicKey() gives SPKI directly, which is why the server needs no CBOR
  // decoder. A null here means this browser cannot express the key that way.
  const spki = created.response.getPublicKey();
  if (!spki) throw new Error('This browser could not read the key from that device. Try another device.');

  await post('/admin/api/register/finish', {
    credentialId: created.id,
    publicKey: b64(spki),
    algorithm: created.response.getPublicKeyAlgorithm(),
    clientDataJSON: b64(created.response.clientDataJSON),
    authenticatorData: b64(created.response.getAuthenticatorData()),
    label: navigator.platform || 'This device',
    transports: (created.response.getTransports?.() || []).join(','),
  });
}

async function login() {
  const options = await post('/admin/api/login/start', {});

  const got = await navigator.credentials.get({
    publicKey: { ...options.publicKey, challenge: unb64(options.publicKey.challenge) },
  });

  await post('/admin/api/login/finish', {
    credentialId: got.id,
    clientDataJSON: b64(got.response.clientDataJSON),
    authenticatorData: b64(got.response.authenticatorData),
    signature: b64(got.response.signature),
  });
}

function wire(form, run) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('ceremony-error').hidden = true;
    form.querySelector('button[type=submit]').disabled = true;
    try {
      await run(form);
      location.href = form.dataset.next || '/admin';
    } catch (err) {
      // NotAllowedError is the user cancelling or the prompt timing out. It is
      // not an error worth alarming them about.
      fail(err.name === 'NotAllowedError'
        ? 'No passkey was used. Try again when you are ready.'
        : (err.message || 'Something went wrong. Try again.'));
    }
  });
}

if (!window.PublicKeyCredential) {
  document.getElementById('no-webauthn').hidden = false;
  document.querySelectorAll('form[data-ceremony]').forEach(f => { f.hidden = true; });
} else {
  document.querySelectorAll('form[data-ceremony=register]').forEach(f => wire(f, register));
  document.querySelectorAll('form[data-ceremony=login]').forEach(f => wire(f, () => login()));
}
`;
