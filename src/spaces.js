// Store only a preference, never an account credential or invitation token.
export function rememberedSpace(username) {
  try {
    return Number(localStorage.getItem(`social-rooms:space:${username}`)) || null;
  } catch {
    return null;
  }
}

export function rememberSpace(username, spaceId) {
  try {
    localStorage.setItem(`social-rooms:space:${username}`, String(spaceId));
  } catch {
    /* Switching also works when browser storage is unavailable. */
  }
}

export function invitationToken(url) {
  return new URLSearchParams(new URL(url).hash.slice(1)).get('invite') || '';
}

export function invitationUrl(token, origin) {
  // A fragment keeps the invitation out of HTTP access logs and referrers.
  return `${origin}/#${new URLSearchParams({ invite: token })}`;
}

export function clearInvitation() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
