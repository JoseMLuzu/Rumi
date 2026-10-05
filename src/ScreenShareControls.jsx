import { useEffect, useRef, useState } from 'react';

function ScreenViewer({ screen }) {
  const dialog = useRef(null);
  const video = useRef(null);
  const [playbackError, setPlaybackError] = useState('');
  useEffect(() => {
    dialog.current.showModal();
    const element = dialog.current;
    return () => element.close();
  }, []);
  useEffect(() => {
    const element = video.current;
    element.srcObject = screen.stream;
    setPlaybackError('');
    if (screen.stream) element.play().catch(() => setPlaybackError('Video playback was blocked. Close and view again.'));
    return () => { element.pause(); element.srcObject = null; };
  }, [screen.stream]);
  return <dialog ref={dialog} className="screen-viewer" aria-labelledby="screen-viewer-title"
    onCancel={event => { event.preventDefault(); screen.closeView(); }}>
    <header>
      <div><p className="eyebrow">LIVING ROOM PROJECTOR</p>
        <h2 id="screen-viewer-title">{screen.share.name}’s screen</h2></div>
      <button className="button secondary" onClick={screen.closeView}>Close viewer</button>
    </header>
    <div className="screen-video-wrap">
      <video ref={video} muted autoPlay playsInline aria-label={`${screen.share.name}’s shared screen`} />
      {!screen.stream && <p role="status">Connecting to the shared screen…</p>}
    </div>
    <footer><span>Target: 720p · screen video only</span>
      <button className="button quiet" onClick={() => video.current.requestFullscreen().catch(() => setPlaybackError('Fullscreen is unavailable in this browser.'))}>Fullscreen</button>
    </footer>
    {playbackError && <p className="screen-error" role="alert">{playbackError}</p>}
  </dialog>;
}

export function ProjectorActions({ screen, connected }) {
  return (
    <aside className="screen-panel" aria-label="Living room screen sharing">
      <p className="eyebrow">LIVING ROOM PROJECTOR</p>
      <p className="screen-status" role="status">{screen.busy ? 'Choose a screen or window…'
        : screen.share ? `${screen.share.name} is sharing a screen.` : 'Put something on the big screen.'}</p>
      <div className="screen-actions">
        {screen.sharing ? <button className="button secondary" onClick={screen.stop}>Stop sharing</button>
          : !screen.share && <button className="button primary" disabled={!connected || screen.busy} onClick={screen.start}>Share screen</button>}
        {screen.busy && <button className="button quiet" onClick={screen.stop}>Cancel</button>}
        {screen.share && <button className="button primary" disabled={!connected || screen.viewing} onClick={screen.view}>View screen</button>}
      </div>
      <small>Preview every 5s · 720p viewing</small>
      {screen.error && <p className="screen-error" role="alert">{screen.error}</p>}
    </aside>
  );
}

export default function ScreenShareControls({ screen, nearby }) {
  return <>
    {/* Keep Stop/Cancel available when the presenter walks away from the projector. */}
    {!nearby && (screen.sharing || screen.busy || screen.error) && <aside className="screen-status-panel" aria-label="Screen sharing status">
      <p className="screen-status" role="status">{screen.sharing ? 'You are sharing on the living room projector.' : screen.busy ? 'Choose a screen or window…' : 'Walk up to the projector to share.'}</p>
      {screen.sharing && <button className="button secondary" onClick={screen.stop}>Stop sharing</button>}
      {screen.busy && <button className="button quiet" onClick={screen.stop}>Cancel</button>}
      {screen.error && <p className="screen-error" role="alert">{screen.error}</p>}
    </aside>}
    {screen.viewing && screen.share && <ScreenViewer screen={screen} />}
  </>;
}
