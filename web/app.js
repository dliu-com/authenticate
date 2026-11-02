import { PublicClientApplication } from '@azure/msal-browser';
import {
  acquireToken, createTokenDisplay, microsoftConfiguration, readConfiguration,
  formatTokenFile, TOKEN_FILE_NAME,
} from './token-console.mjs';

const signIn = document.querySelector('#sign-in');
const copy = document.querySelector('#copy');
const copyFile = document.querySelector('#copy-file');
const save = document.querySelector('#save');
const clear = document.querySelector('#clear');
const status = document.querySelector('#status');
const tokenPanel = document.querySelector('#token-panel');
const tokenField = document.querySelector('#token');
let client;
let config;
let busy = false;
let generation = 0;
let hasToken = false;
let activeExports = 0;
function updateExportButtons() {
  copy.disabled = !hasToken || activeExports > 0;
  copyFile.disabled = !hasToken || activeExports > 0;
  save.disabled = !hasToken || activeExports > 0;
}
const display = createTokenDisplay({
  render(result, reason) {
    tokenField.value = result?.accessToken || '';
    tokenPanel.hidden = !result;
    hasToken = Boolean(result);
    updateExportButtons();
    if (result) {
      document.querySelector('#expires').textContent = result.expiresOn.toLocaleString();
      status.textContent = 'Your token is ready.';
    } else if (reason === 'expired') {
      status.textContent = 'Token expired. Sign in to get a new one.';
    }
  },
});

function setBusy(value) {
  busy = value;
  signIn.disabled = value || !client;
  signIn.textContent = value ? 'Signing in...' : 'Sign in with Microsoft';
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') display.refresh();
});
window.addEventListener('pagehide', () => {
  generation++;
  display.clear();
});
clear.addEventListener('click', () => {
  display.clear();
  status.textContent = 'Token cleared. Copies remain valid until expiry.';
});

function checkFileExport(value, signal) {
  if (signal.aborted) throw new DOMException('File export cancelled.', 'AbortError');
  if (value.expiresOn.getTime() <= Date.now()) throw new Error('The access token expired before saving.');
}

async function saveTokenFile(value, signal) {
  if (typeof window.showSaveFilePicker === 'function') {
    const handle = await window.showSaveFilePicker({ suggestedName: TOKEN_FILE_NAME });
    checkFileExport(value, signal);
    const writable = await handle.createWritable();
    try {
      checkFileExport(value, signal);
      await writable.write(formatTokenFile(value));
      checkFileExport(value, signal);
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }
    return handle.name === TOKEN_FILE_NAME ? 'saved' : 'saved-other-name';
  }
  checkFileExport(value, signal);
  const url = URL.createObjectURL(new Blob([formatTokenFile(value)], {
    type: 'text/plain;charset=utf-8',
  }));
  const revoke = URL.revokeObjectURL.bind(URL);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = TOKEN_FILE_NAME;
    document.body.append(link);
    link.click();
    return 'downloaded';
  } finally {
    link.remove();
    setTimeout(() => revoke(url), 0);
  }
}

save.addEventListener('click', async () => {
  const request = generation;
  activeExports++;
  updateExportButtons();
  status.textContent = 'Use .dliu_token, including the leading dot, as the file name.';
  try {
    const outcome = await display.save(saveTokenFile);
    if (request === generation && display.refresh()) {
      status.textContent = outcome === 'saved'
        ? 'Saved. You can save or copy this token again.'
        : outcome === 'saved-other-name'
          ? 'Saved. Rename the file to .dliu_token, including the leading dot, so clients can find it.'
          : 'Download started. Save the file in your home folder as .dliu_token, including the leading dot.';
    }
  } catch (error) {
    if (request === generation && display.refresh()) {
      status.textContent = error?.name === 'AbortError'
        ? 'Save cancelled. Your token is still available.'
        : 'The file could not be saved. Your token is still available.';
    }
  } finally {
    activeExports--;
    updateExportButtons();
  }
});
async function copyToClipboard(fileContents) {
  const request = generation;
  activeExports++;
  updateExportButtons();
  try {
    const write = (value) => navigator.clipboard.writeText(value);
    if (fileContents) await display.copyFile(write);
    else await display.copy(write);
    if (request === generation && display.refresh()) {
      status.textContent = fileContents
        ? 'Token file copied: token and UTC expiry. Paste it into .dliu_token.'
        : 'Copied. You can copy or save this token again.';
    }
  } catch {
    if (request === generation && display.refresh()) {
      status.textContent = fileContents
        ? 'The token file could not be copied. Your token is still available to try again.'
        : 'Your token could not be copied. It is still available to try again.';
    }
  } finally {
    activeExports--;
    updateExportButtons();
  }
}
copy.addEventListener('click', () => copyToClipboard(false));
copyFile.addEventListener('click', () => copyToClipboard(true));
signIn.addEventListener('click', async () => {
  if (busy || !client) return;
  display.clear();
  const request = ++generation;
  setBusy(true);
  status.textContent = 'Complete sign-in in the Microsoft window.';
  try {
    const result = await acquireToken(client, config);
    if (request !== generation) return;
    display.show(result);
  } catch {
    display.clear();
    status.textContent = 'Sign-in did not finish. Please try again; see Docs if it keeps failing.';
  } finally {
    setBusy(false);
  }
});

async function initialize() {
  window.history.replaceState(null, '', window.location.pathname);
  const response = await fetch('/config.json', { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('The token console configuration could not be loaded.');
  config = readConfiguration(await response.json());
  client = new PublicClientApplication(microsoftConfiguration(config, window.location.origin));
  await client.initialize();
  await client.clearCache();
  save.textContent = typeof window.showSaveFilePicker === 'function' ? 'Save file' : 'Download file';
  signIn.disabled = false;
  status.textContent = 'Ready to sign in.';
}

initialize().catch(() => {
  client = undefined;
  signIn.disabled = true;
  status.textContent = 'Sign-in is unavailable. Please try again later.';
});
