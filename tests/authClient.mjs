// Node has no browser cookie jar. This test helper explicitly follows our HTTP session flow.
export async function authenticate(url, username, password, create = false) {
  if (!username || !password)
    throw new Error('Set TEST_USERNAME and TEST_PASSWORD for this check.');
  const cookies = new Map();
  let csrfToken;
  async function request(path, options = {}) {
    const headers = { ...options.headers, Origin: new URL(url).origin };
    if (cookies.size)
      headers.Cookie = Array.from(cookies, ([key, value]) => `${key}=${value}`).join('; ');
    if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(url + path, { ...options, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    if (body.csrfToken) csrfToken = body.csrfToken;
    return body;
  }
  await request('/api/auth/session');
  const result = await request(`/api/auth/${create ? 'register' : 'login'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return {
    user: result.user,
    request,
    get csrfToken() {
      return csrfToken;
    },
    get cookie() {
      return Array.from(cookies, ([key, value]) => `${key}=${value}`).join('; ');
    },
  };
}
