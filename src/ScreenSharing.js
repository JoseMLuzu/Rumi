const CAPTURE_OPTIONS = {
  video: { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 30, max: 30 } },
  audio: false,
};
const PREVIEW_INTERVAL_MS = 5000;
const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 135;

// Own browser resources here, rather than recreating streams/connections on React renders.
export default class ScreenSharing {
  constructor(socket, isCentral, onState) {
    this.socket = socket;
    this.isCentral = isCentral;
    this.onState = onState;
    this.state = { share: null, preview: null, sharing: false, busy: false, viewing: false, stream: null, error: '' };
    this.peers = new Map();
    this.generation = 0;
    this.watchGeneration = 0;
    this.listeners = {
      screen_state: data => this.setShare(data),
      screen_preview: data => {
        if (data.sessionId === this.state.share?.sessionId) this.update({ preview: data.frame });
      },
      screen_viewer_joined: data => {
        if (this.state.sharing && data.sessionId === this.state.share?.sessionId) this.offerTo(data.id);
      },
      screen_viewer_left: data => {
        if (data.sessionId === this.state.share?.sessionId) this.closePeer(data.id);
      },
      screen_signal: signal => this.receiveSignal(signal),
      disconnect: () => {
        this.stop();
        this.update({ share: null, preview: null, error: '' });
      },
    };
    for (const [event, listener] of Object.entries(this.listeners)) socket.on(event, listener);
    if (isCentral) {
      this.abort = new AbortController();
      // Fetch ahead of the click: screen capture itself must start during a user gesture.
      this.config = fetch('/api/voice-config', { signal: this.abort.signal, cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('Could not load screen connection settings. Re-enter your saved name.');
          const config = await response.json();
          if (!Array.isArray(config.iceServers)) throw new Error('Invalid screen connection settings.');
          return config;
        }).catch(error => ({ error }));
    }
  }

  update(changes) {
    this.state = { ...this.state, ...changes };
    this.onState(this.state);
  }

  setShare({ share, preview }) {
    if (share?.sessionId !== this.state.share?.sessionId) {
      this.closeView();
      for (const id of this.peers.keys()) this.closePeer(id);
      if (this.state.sharing) this.releaseCapture();
    }
    // The broadcast can precede our start acknowledgement. Be ready for early viewers.
    this.update({ share, preview, sharing: !!share && share.id === this.socket.id && !!this.capture });
  }

  async settings() {
    const config = await this.config;
    if (config?.error) throw config.error;
    this.iceServers = config.iceServers;
  }

  async start() {
    if (!this.isCentral || !this.socket.connected || this.state.busy || this.state.share) return;
    const generation = ++this.generation;
    this.update({ busy: true, error: '' });
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen sharing needs HTTPS or localhost and a supported desktop browser.');
      }
      // Call before any await so the browser can show its native screen/window picker.
      const stream = await navigator.mediaDevices.getDisplayMedia(CAPTURE_OPTIONS);
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.capture = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('The selected source did not provide video.');
      track.contentHint = 'detail'; // Favor readable screen text over fast-motion video.
      track.onended = () => this.stop(); // Also handles the browser's own Stop sharing button.
      await this.settings();
      if (generation !== this.generation) return;
      const reply = await this.socket.timeout(5000).emitWithAck('screen_start', {});
      if (generation !== this.generation) {
        if (reply?.ok) this.socket.emit('screen_stop', { sessionId: reply.share.sessionId });
        return;
      }
      if (!reply?.ok) throw new Error(reply?.error || 'Could not start screen sharing.');
      this.update({ share: reply.share, sharing: true, busy: false });
      this.startPreview();
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      this.update({ error: error.name === 'NotAllowedError' ? 'Screen selection was canceled or permission was denied.'
        : error.name === 'NotReadableError' ? 'Screen capture is blocked. Check your browser and macOS Screen Recording permission.'
          : error.message || 'Could not share the screen.' });
    }
  }

  startPreview() {
    this.previewVideo = document.createElement('video');
    this.previewVideo.muted = true;
    this.previewVideo.playsInline = true;
    this.previewVideo.srcObject = this.capture;
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const context = canvas.getContext('2d');
    const snapshot = () => {
      const video = this.previewVideo;
      if (!this.state.sharing || !video || video.readyState < 2) return;
      const scale = Math.min(PREVIEW_WIDTH / video.videoWidth, PREVIEW_HEIGHT / video.videoHeight);
      const width = video.videoWidth * scale, height = video.videoHeight * scale;
      context.fillStyle = '#172722';
      context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      context.drawImage(video, (PREVIEW_WIDTH - width) / 2, (PREVIEW_HEIGHT - height) / 2, width, height);
      let frame = canvas.toDataURL('image/jpeg', 0.45);
      if (frame.length > 12000) frame = canvas.toDataURL('image/jpeg', 0.2);
      // Encode a still image occasionally; only explicit viewers receive full video.
      if (frame.length <= 12000) this.socket.emit('screen_preview', { sessionId: this.state.share.sessionId, frame });
    };
    this.previewTimer = setInterval(snapshot, PREVIEW_INTERVAL_MS);
    // Show the first snapshot as soon as playback starts, then keep it for five seconds.
    this.previewVideo.play().then(snapshot).catch(() => {
      if (this.state.sharing) this.update({ error: 'The projector preview could not play. Stop and share again.' });
    });
  }

  async view() {
    if (!this.state.share || this.state.viewing || !this.socket.connected) return;
    const share = this.state.share;
    const generation = ++this.watchGeneration;
    this.update({ viewing: true, stream: this.state.sharing ? this.capture : null, error: '' });
    try {
      await this.settings();
      if (generation !== this.watchGeneration) return;
      const reply = await this.socket.timeout(5000).emitWithAck('screen_watch', { sessionId: share.sessionId, watching: true });
      if (generation !== this.watchGeneration) return;
      if (!reply?.ok) throw new Error(reply?.error || 'Could not view the screen.');
    } catch (error) {
      if (generation !== this.watchGeneration) return;
      this.closeView();
      this.update({ error: error.message || 'Could not view the screen.' });
    }
  }

  closeView() {
    ++this.watchGeneration;
    if (this.state.viewing && this.state.share && this.socket.connected) {
      this.socket.emit('screen_watch', { sessionId: this.state.share.sessionId, watching: false });
    }
    if (!this.state.sharing) for (const id of this.peers.keys()) this.closePeer(id);
    this.update({ viewing: false, stream: null });
  }

  createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry = { pc, sessionId: this.state.share.sessionId, candidates: [], queue: Promise.resolve() };
    this.peers.set(id, entry);
    if (this.state.sharing) {
      const track = this.capture.getVideoTracks()[0];
      const { width = 1280, height = 720 } = track.getSettings();
      pc.addTransceiver(track, { direction: 'sendonly', streams: [this.capture], sendEncodings: [{
        maxBitrate: 2500000, maxFramerate: 30, scaleResolutionDownBy: Math.max(1, width / 1280, height / 720),
      }] });
    }
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.isCurrent(id, entry)) this.signal(id, { candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ streams, track }) => {
      if (this.isCurrent(id, entry) && this.state.viewing) this.update({ stream: streams[0] || new MediaStream([track]) });
    };
    const fail = () => {
      if (!this.isCurrent(id, entry)) return;
      this.closePeer(id);
      if (!this.state.sharing) this.closeView();
      this.update({ error: 'Screen video could not connect. Try viewing again; this network may need a TURN relay.' });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') clearTimeout(entry.timeout);
      if (pc.connectionState === 'failed') fail();
    };
    entry.timeout = setTimeout(fail, 20000);
    return entry;
  }

  offerTo(id) {
    const entry = this.peers.get(id) || this.createPeer(id);
    this.enqueue(id, entry, async () => {
      await entry.pc.setLocalDescription(await entry.pc.createOffer());
      if (this.isCurrent(id, entry)) this.signal(id, { description: entry.pc.localDescription.toJSON() });
    });
  }

  signal(id, signal) {
    this.socket.emit('screen_signal', { to: id, sessionId: this.state.share.sessionId, ...signal });
  }

  receiveSignal(signal) {
    if (!signal || signal.sessionId !== this.state.share?.sessionId) return;
    const isPresenter = this.state.sharing && this.state.share.id === this.socket.id;
    if (!isPresenter && (!this.state.viewing || signal.from !== this.state.share.id)) return;
    // Only the presenter initiates. Reject unsolicited offers addressed to the presenter.
    const entry = this.peers.get(signal.from) || (!isPresenter && this.createPeer(signal.from));
    if (!entry) return;
    this.enqueue(signal.from, entry, async () => {
      if (signal.description) {
        await entry.pc.setRemoteDescription(signal.description);
        if (!this.isCurrent(signal.from, entry)) return;
        for (const candidate of entry.candidates.splice(0)) await entry.pc.addIceCandidate(candidate);
        if (signal.description.type === 'offer') {
          await entry.pc.setLocalDescription(await entry.pc.createAnswer());
          if (this.isCurrent(signal.from, entry)) this.signal(signal.from, { description: entry.pc.localDescription.toJSON() });
        }
      } else if (signal.candidate) {
        // Network packets can arrive before their offer/answer; wait until it exists.
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(signal.candidate);
        else if (entry.candidates.length < 64) entry.candidates.push(signal.candidate);
      }
    });
  }

  isCurrent(id, entry) {
    return this.peers.get(id) === entry && entry.sessionId === this.state.share?.sessionId;
  }

  enqueue(id, entry, operation) {
    entry.queue = entry.queue.then(() => { if (this.isCurrent(id, entry)) return operation(); })
      .catch(() => {
        if (!this.isCurrent(id, entry)) return;
        this.closePeer(id);
        if (!this.state.sharing) this.closeView();
        this.update({ error: 'Screen connection setup failed. Close the viewer and try again.' });
      });
  }

  closePeer(id) {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.peers.delete(id);
    clearTimeout(entry.timeout);
    entry.pc.onicecandidate = entry.pc.ontrack = entry.pc.onconnectionstatechange = null;
    entry.pc.close();
  }

  releaseCapture() {
    ++this.generation;
    clearInterval(this.previewTimer);
    if (this.previewVideo) {
      this.previewVideo.pause();
      this.previewVideo.srcObject = null;
      this.previewVideo = null;
    }
    this.capture?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.capture = null;
    this.update({ sharing: false, busy: false });
  }

  stop() {
    if (this.state.share?.id === this.socket.id && this.socket.connected) {
      this.socket.emit('screen_stop', { sessionId: this.state.share.sessionId });
    }
    this.closeView();
    this.releaseCapture();
    for (const id of this.peers.keys()) this.closePeer(id);
  }

  dispose() {
    this.stop();
    this.abort?.abort();
    for (const [event, listener] of Object.entries(this.listeners)) this.socket.off(event, listener);
  }
}
