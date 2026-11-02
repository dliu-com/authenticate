export const API_PERMISSIONS = Object.freeze([
  'video.read', 'video.write', 'video.delete',
  'files.read', 'files.write', 'files.delete',
  'blog.read', 'blog.write', 'blog.delete',
  'trip.read', 'trip.write', 'trip.delete',
]);
export const TOKEN_FILE_NAME = '.dliu_token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readConfiguration(value) {
  if (!value || value.configured !== true ||
      !['tenantId', 'clientId', 'audience'].every((key) => UUID.test(value[key]))) {
    throw new Error('Token console setup is incomplete. Microsoft sign-in is unavailable.');
  }
  return { tenantId: value.tenantId, clientId: value.clientId, audience: value.audience };
}

export function microsoftConfiguration(config, origin) {
  const url = new URL(origin);
  if (url.origin !== origin || (origin !== 'https://auth.dliu.com' &&
      !(/^http:$/.test(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('The token console must run on its registered HTTPS origin.');
  }
  return {
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: `${origin}/redirect.html`,
      navigateToLoginRequestUrl: false,
    },
    cache: {
      cacheLocation: 'memoryStorage',
      cacheRetentionDays: 0,
    },
    system: {
      allowPlatformBroker: false,
      loggerOptions: {
        piiLoggingEnabled: false,
        logLevel: 0,
        // The UI reports failures without recording raw SDK diagnostics.
        loggerCallback: () => {},
      },
    },
  };
}

export async function acquireToken(client, config) {
  try {
    const result = await client.acquireTokenPopup({
      scopes: API_PERMISSIONS.map((scope) => `api://${config.audience}/${scope}`),
      prompt: 'select_account',
      storeInCache: { accessToken: false, idToken: false, refreshToken: false },
    });
    if (typeof result?.accessToken !== 'string' || !result.accessToken.trim() ||
        !(result.expiresOn instanceof Date) ||
        !Number.isFinite(result.expiresOn.getTime()) || result.expiresOn.getTime() <= Date.now() ||
        !Array.isArray(result.scopes) || result.scopes.length === 0) {
      throw new Error('Microsoft did not return a usable API access token.');
    }
    return {
      accessToken: result.accessToken,
      expiresOn: result.expiresOn,
      scopes: [...result.scopes],
    };
  } finally {
    await client.clearCache();
  }
}

export function formatTokenFile({ accessToken, expiresOn }) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\r\n]/.test(accessToken) ||
      !(expiresOn instanceof Date) || !Number.isFinite(expiresOn.getTime())) {
    throw new Error('The token file data is invalid.');
  }
  return `token=${accessToken}\nexpires_at=${expiresOn.toISOString()}\n`;
}

export function createTokenDisplay({
  render, now = Date.now, schedule = setTimeout, cancel = clearTimeout,
}) {
  let token = '';
  let deadline = 0;
  let expiresOn;
  let timer;
  const pendingExports = new Set();
  function clear(reason = 'cleared') {
    token = '';
    deadline = 0;
    expiresOn = undefined;
    for (const pending of pendingExports) {
      pending.value.accessToken = '';
      pending.controller.abort();
    }
    pendingExports.clear();
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    render(null, reason);
  }
  function refresh() {
    if (token && now() >= deadline) clear('expired');
    return Boolean(token);
  }
  function scheduleExpiry() {
    const remaining = deadline - now();
    if (remaining <= 0) {
      clear('expired');
      return;
    }
    timer = schedule(() => {
      timer = undefined;
      scheduleExpiry();
    }, Math.min(remaining, 2_147_483_647));
  }
  async function exportSnapshot(write) {
    if (!refresh()) {
      throw new Error('The token is no longer available. Sign in to obtain another.');
    }
    const value = { accessToken: token, expiresOn: new Date(expiresOn.getTime()) };
    const pending = { value, controller: new AbortController() };
    pendingExports.add(pending);
    try {
      return await write(value, pending.controller.signal);
    } finally {
      value.accessToken = '';
      pendingExports.delete(pending);
    }
  }
  return {
    clear, refresh,
    show(result) {
      clear();
      if (typeof result?.accessToken !== 'string' || !result.accessToken.trim() ||
          !(result.expiresOn instanceof Date) || !Number.isFinite(result.expiresOn.getTime())) {
        throw new Error('The access token is invalid.');
      }
      deadline = result.expiresOn.getTime();
      if (!result.accessToken || deadline <= now()) throw new Error('The access token has expired.');
      token = result.accessToken;
      expiresOn = new Date(result.expiresOn.getTime());
      render({ ...result, hideAt: new Date(deadline) });
      scheduleExpiry();
    },
    async copy(writeText) {
      return exportSnapshot((value) => writeText(value.accessToken));
    },
    async copyFile(writeText) {
      return exportSnapshot((value) => writeText(formatTokenFile(value)));
    },
    async save(writeFile) {
      return exportSnapshot(writeFile);
    },
  };
}
