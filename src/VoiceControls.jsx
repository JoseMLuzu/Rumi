import { useEffect, useRef } from 'react';
import Icon from './ui/Icon.jsx';

export default function VoiceControls({ voice, connected }) {
  const information = useRef(null);
  useEffect(() => {
    const dismiss = (event) => {
      const menu = information.current;
      if (!menu) return;
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'keydown' || !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismiss);
    };
  }, []);

  return (
    <aside
      className="voice-panel voice-compact"
      aria-label="Proximity voice chat"
      data-visible-in-editor={voice.enabled || voice.busy || !!voice.error}
    >
      <div className="voice-row">
        {voice.enabled ? (
          <>
            <button
              className="button secondary"
              onClick={voice.toggleMute}
              aria-pressed={voice.muted}
            >
              <Icon name={voice.muted ? 'muted' : 'mic'} />
              {voice.muted ? 'Unmute mic' : 'Mute mic'}
            </button>
            <span className="voice-nearby" role="status">
              {voice.nearby} nearby
            </span>
          </>
        ) : (
          <button
            className="button primary"
            onClick={voice.join}
            disabled={!connected || voice.busy}
          >
            <Icon name="mic" />
            {voice.busy ? 'Joining…' : 'Join Voice'}
          </button>
        )}
        {voice.busy && (
          <button className="button quiet" onClick={voice.leave}>
            Cancel
          </button>
        )}
        <details ref={information} className="voice-details">
          <summary aria-label="Voice information" title="Voice information">
            <Icon name="info" />
          </summary>
          <div className="voice-info">
            <strong>Proximity voice</strong>
            <p className="voice-status" role="status">
              {voice.busy
                ? 'Waiting for microphone access…'
                : voice.enabled
                  ? `${voice.muted ? 'Mic muted' : 'Mic on'} · ${voice.connections} connected · ${voice.nearby} nearby`
                  : 'Talk with people close to your character.'}
            </p>
            <small>Same room · louder nearby, silent farther away</small>
            {voice.enabled && (
              <button className="button quiet" onClick={voice.leave}>
                Leave Voice
              </button>
            )}
          </div>
        </details>
      </div>
      {voice.error && (
        <p className="voice-error" role="alert">
          {voice.error}
        </p>
      )}
    </aside>
  );
}
