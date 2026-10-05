import Icon from './ui/Icon.jsx';

export default function VoiceControls({ voice, connected }) {
  return (
    <aside className="voice-panel" aria-label="Proximity voice chat">
      <div className="voice-main">
        <span className={`voice-indicator ${voice.enabled && !voice.muted ? 'is-active' : ''}`}>
          <Icon name={voice.muted ? 'muted' : 'mic'} />
        </span>
        <div className="voice-label">
          <strong>Proximity voice</strong>
          <span role="status">
            {voice.enabled
              ? `${voice.muted ? 'Muted' : 'Mic on'} · ${voice.nearby} nearby`
              : 'Say hello to someone nearby'}
          </span>
        </div>
        <details className="voice-details">
          <summary aria-label="Voice information">
            <Icon name="info" />
          </summary>
          <div className="voice-info">
            <p className="voice-status">
              {voice.busy
                ? 'Waiting for microphone access…'
                : voice.enabled
                  ? `${voice.muted ? 'Mic muted' : 'Mic on'} · ${voice.connections} connected · ${voice.nearby} nearby`
                  : 'Talk with people close to your character.'}
            </p>
            <small>Same room · louder nearby, silent farther away</small>
          </div>
        </details>
      </div>
      <div className="voice-actions">
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
            <button className="button quiet" onClick={voice.leave}>
              Leave Voice
            </button>
          </>
        ) : (
          <>
            <button
              className="button primary"
              onClick={voice.join}
              disabled={!connected || voice.busy}
            >
              {voice.busy ? 'Joining…' : 'Join Voice'}
            </button>
            {voice.busy && (
              <button className="button quiet" onClick={voice.leave}>
                Cancel
              </button>
            )}
          </>
        )}
      </div>
      {voice.error && (
        <p className="voice-error" role="alert">
          {voice.error}
        </p>
      )}
    </aside>
  );
}
