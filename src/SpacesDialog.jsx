import { useEffect, useRef, useState } from 'react';
import {
  createSpace,
  joinSpace,
  previewSpaceInvitation,
  generateSpaceInvitation,
  revokeSpaceInvitation,
} from './api.js';
import { invitationUrl } from './spaces.js';
import Icon from './ui/Icon.jsx';

export default function SpacesDialog({
  refreshError,
  spaces,
  currentSpace,
  pendingInvitation,
  onEntered,
  onDismissInvitation,
  onClose,
  standalone = false,
  onLogout,
  loggingOut,
}) {
  const dialog = useRef(null);
  const linkInput = useRef(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invited, setInvited] = useState(null);
  const [invitationError, setInvitationError] = useState('');
  const [link, setLink] = useState('');
  const [expiresAt, setExpiresAt] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (standalone) return;
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, [standalone]);

  useEffect(() => {
    let active = true;
    setInvited(null);
    setInvitationError('');
    if (pendingInvitation)
      previewSpaceInvitation(pendingInvitation)
        .then((data) => {
          if (active) setInvited(data);
        })
        .catch((failure) => {
          if (active) setInvitationError(failure.message);
        });
    return () => {
      active = false;
    };
  }, [pendingInvitation]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <>
      <div className="directory-header">
        <div>
          <p className="eyebrow">SOCIAL ROOMS</p>
          <h2 id="spaces-title">Your spaces.</h2>
        </div>
        {standalone ? (
          <button className="button quiet" onClick={onLogout} disabled={busy || loggingOut}>
            Log out
          </button>
        ) : (
          <button className="button quiet" onClick={onClose} disabled={busy}>
            Close
          </button>
        )}
      </div>
      <p className="spaces-intro">
        A house for each circle of friends. Each space has its own living room and bedrooms.
      </p>
      {refreshError && <p role="alert">{refreshError}</p>}
      {pendingInvitation && (
        <section className="space-invitation" aria-label="Space invitation">
          <p className="eyebrow">YOU’RE INVITED</p>
          {invited ? (
            <>
              <h3>{invited.name}</h3>
              <p>
                {invited.alreadyMember
                  ? 'You already belong to this space.'
                  : 'Accept to join your friends and get a bedroom in this space.'}
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const space = await joinSpace(pendingInvitation);
                    onDismissInvitation();
                    onEntered(space);
                  })
                }
              >
                {busy ? 'Joining…' : invited.alreadyMember ? 'Open space' : 'Accept invitation'}
              </button>
            </>
          ) : invitationError ? (
            <p role="alert">{invitationError}</p>
          ) : (
            <p role="status">Checking invitation…</p>
          )}
          <button className="button quiet" disabled={busy} onClick={onDismissInvitation}>
            Dismiss invitation
          </button>
        </section>
      )}
      <div className="space-list" aria-label="Your spaces">
        {spaces.map((space) => (
          <button
            key={space.id}
            className={`space-card ${currentSpace?.id === space.id ? 'space-current' : ''}`}
            onClick={() => onEntered(space)}
            disabled={busy}
            aria-current={currentSpace?.id === space.id ? 'true' : undefined}
          >
            <span className="space-avatar" aria-hidden="true">
              {space.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{space.name}</strong>
              <small>
                {space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}
                {space.isHost ? ' · Host' : ''}
              </small>
            </span>
            <span>{currentSpace?.id === space.id ? 'You’re here' : 'Enter →'}</span>
          </button>
        ))}
        {!spaces.length && (
          <p className="spaces-empty">
            You don’t belong to a space yet. Create one or open a friend’s invitation link.
          </p>
        )}
      </div>
      {currentSpace && (
        <section className="space-share">
          <h3>Invite friends to {currentSpace.name}</h3>
          {currentSpace.isHost ? (
            <>
              <p>Links work for 7 days. Creating a new link replaces the previous one.</p>
              <div className="space-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await generateSpaceInvitation(currentSpace.id);
                      setLink(invitationUrl(result.token, window.location.origin));
                      setExpiresAt(result.expiresAt);
                    })
                  }
                >
                  <Icon name="people" />
                  {link ? 'Replace invitation link' : 'Create invitation link'}
                </button>
                <button
                  className="button quiet"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await revokeSpaceInvitation(currentSpace.id);
                      setLink('');
                      setExpiresAt(null);
                      setNotice('Invitation links revoked. Existing members keep access.');
                    })
                  }
                >
                  Revoke link
                </button>
              </div>
              {link && (
                <>
                  <label htmlFor="space-link">Share this link</label>
                  <textarea
                    ref={linkInput}
                    id="space-link"
                    readOnly
                    value={link}
                    onFocus={(event) => event.target.select()}
                    rows={3}
                  />
                  <div className="space-actions">
                    <button
                      className="button primary"
                      onClick={() =>
                        run(async () => {
                          try {
                            await navigator.clipboard.writeText(link);
                            setNotice('Invitation copied.');
                          } catch {
                            linkInput.current.focus();
                            linkInput.current.select();
                            setNotice('Select and copy the invitation above.');
                          }
                        })
                      }
                    >
                      Copy link
                    </button>
                    <small>Expires {new Date(expiresAt * 1000).toLocaleDateString()}</small>
                  </div>
                </>
              )}
            </>
          ) : (
            <p>Ask a host for an invitation link to share with friends.</p>
          )}
        </section>
      )}
      <form
        className="space-create"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            const space = await createSpace(name);
            onEntered(space);
          });
        }}
      >
        <h3>Create a space</h3>
        <label htmlFor="space-name">Space name</label>
        <div className="space-actions">
          <input
            id="space-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Friday friends"
            maxLength={48}
            required
            disabled={busy}
          />
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? 'Please wait…' : 'Create space'}
          </button>
        </div>
      </form>
      {error && (
        <p className="entry-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );

  return standalone ? (
    <main className="connection-screen name-entry space-entry">
      <section className="space-lobby">{content}</section>
    </main>
  ) : (
    <dialog
      ref={dialog}
      className="room-directory spaces-dialog"
      aria-labelledby="spaces-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {content}
    </dialog>
  );
}
