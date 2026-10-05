import { useState } from 'react';
import { login, register } from './api.js';
import Icon from './ui/Icon.jsx';

// Capture the invitation before removing it from browser history. Never persist it.
const invitation = new URLSearchParams(window.location.hash.slice(1));
let activationCode = invitation.get('activate') || '';
let invitedName = invitation.get('username') || '';
if (activationCode)
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

export default function AuthScreen({ onEnter, notice }) {
  const [mode, setMode] = useState(activationCode ? 'register' : 'login');
  const [username, setUsername] = useState(invitedName);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const creating = mode === 'register';

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (creating && password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const user = creating
        ? await register(username, password, activationCode)
        : await login(username, password);
      setPassword('');
      setConfirmation('');
      activationCode = '';
      invitedName = '';
      onEnter(user);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="connection-screen name-entry">
      <section className="connection-card auth-card">
        <div className="entry-emblem">
          <Icon name="home" />
        </div>
        <p className="eyebrow">SOCIAL ROOMS · A SHARED HOUSE</p>
        <h1>
          {activationCode && creating
            ? 'Keep your bedroom. Make it yours.'
            : creating
              ? 'Make yourself at home.'
              : 'Welcome home.'}
        </h1>
        <p>
          {creating
            ? 'Create an account, then join a space or make one of your own.'
            : 'Log in to your bedroom and meet everyone in the living room.'}
        </p>
        <div className="auth-tabs" aria-label="Account action">
          {['login', 'register'].map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={mode === tab}
              disabled={busy}
              onClick={() => {
                setMode(tab);
                setError('');
                setPassword('');
                setConfirmation('');
              }}
            >
              {tab === 'login' ? 'Log in' : 'Create account'}
            </button>
          ))}
        </div>
        {notice && <p role="status">{notice}</p>}
        {activationCode && creating && (
          <p className="auth-hint">
            This private invitation links your existing room. Choose a password to activate it.
          </p>
        )}
        <form onSubmit={submit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={24}
            required
            autoFocus
            autoComplete="username"
            disabled={busy || (!!activationCode && creating)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={12}
            maxLength={128}
            required
            autoComplete={creating ? 'new-password' : 'current-password'}
            disabled={busy}
            aria-describedby="password-help"
          />
          {creating && (
            <>
              <label htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                name="confirmation"
                type={showPassword ? 'text' : 'password'}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={12}
                maxLength={128}
                required
                autoComplete="new-password"
                disabled={busy}
              />
            </>
          )}
          <label className="auth-show-password">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => setShowPassword(event.target.checked)}
            />
            Show password
          </label>
          <p id="password-help" className="auth-hint">
            Use 12–128 characters. A memorable phrase works well. Usernames ignore capitalization.
          </p>
          {error && (
            <p className="entry-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" type="submit" disabled={busy}>
            {busy
              ? 'Opening your bedroom…'
              : creating
                ? activationCode
                  ? 'Activate my account'
                  : 'Create account & enter'
                : 'Log in'}
          </button>
        </form>
      </section>
    </main>
  );
}
