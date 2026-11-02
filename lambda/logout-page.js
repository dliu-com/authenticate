// OAC requires a SHA256 payload header, which a native HTML form cannot provide.
export const logoutScript = String.raw`
'use strict';
const form = document.querySelector('form');
const error = document.getElementById('logout-error');
const buttons = [...form.querySelectorAll('button')];
buttons.forEach((button) => { button.disabled = false; });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  buttons.forEach((button) => { button.disabled = true; });
  error.textContent = '';
  try {
    const data = new URLSearchParams(new FormData(form));
    data.set('mode', event.submitter.value);
    const body = data.toString();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const hex = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const response = await fetch('/auth/logout', {
      method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-amz-content-sha256': hex },
      body,
    });
    if (!response.ok) throw new Error('Sign-out failed. Reload this page and try again.');
    const result = await response.json();
    window.location.assign(result.redirect_to);
  } catch {
    error.textContent = 'Sign-out could not be completed. Reload this page and try again.';
    buttons.forEach((button) => { button.disabled = false; });
  }
});
`;
