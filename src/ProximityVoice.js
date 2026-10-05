import { playerDistance, voiceVolume, VOICE_DISTANCE, VOICE_DISCONNECT_DISTANCE } from './voiceMath.js';

// Browser resources have a different lifetime from React renders. One instance owns
// this room's microphone, peer connections, audio graph, and socket listeners.
export default class ProximityVoice {
  constructor(socket, getPosition, onState) {
    this.socket = socket;
    this.getPosition = getPosition;
    this.onState = onState;
    this.state = { enabled: false, muted: false, busy: false, connections: 0, nearby: 0, error: '' };
    this.remotePlayers = new Map();
    this.peers = new Map();
    this.failedPeers = new Set();
    this.pendingSignals = [];
    this.generation = 0;
    this.listeners = {
      room_state: ({ players }) => {
        this.remotePlayers = new Map(players.filter(player => player.id !== socket.id).map(player => [player.id, player]));
      },
      player_joined: player => this.updatePlayer(player),
      player_moved: player => this.updatePlayer(player),
      player_voice_changed: player => this.updatePlayer(player),
      player_left: ({ id }) => {
        this.remotePlayers.delete(id);
        this.failedPeers.delete(id);
        this.closePeer(id);
      },
      voice_signal: signal => this.receiveSignal(signal),
      disconnect: () => this.leave(),
    };
    for (const [event, listener] of Object.entries(this.listeners)) socket.on(event, listener);
  }

  updateState(changes) {
    const next = { ...this.state, ...changes };
    if (Object.keys(next).some(key => next[key] !== this.state[key])) {
      this.state = next;
      this.onState(next);
    }
  }

  updatePlayer(player) {
    if (player.id === this.socket.id) return;
    this.remotePlayers.set(player.id, { ...this.remotePlayers.get(player.id), ...player });
    if (player.voiceEnabled === false) {
      this.closePeer(player.id);
      this.failedPeers.delete(player.id);
    }
  }

  async join() {
    if (this.state.enabled || this.state.busy || !this.socket.connected) return;
    const generation = ++this.generation;
    this.updateState({ busy: true, error: '' });
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access needs HTTPS or localhost. Open the public app link.');
      }
      if (!globalThis.RTCPeerConnection || !globalThis.AudioContext) {
        throw new Error('This browser does not support voice. Try a current Chrome, Firefox or Safari.');
      }
      // Start the audio context within the button click, so browser autoplay rules
      // do not silently block playback after microphone permission is granted.
      this.context = new AudioContext();
      await this.context.resume();
      if (generation !== this.generation) return;
      this.abort = new AbortController();
      const response = await fetch('/api/voice-config', { signal: this.abort.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load voice configuration. Re-enter your saved name.');
      const config = await response.json();
      if (!Array.isArray(config.iceServers)) throw new Error('The server returned invalid voice configuration.');
      this.iceServers = config.iceServers;
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
      // A permission dialog can resolve after Cancel, room travel, or unmount.
      // A late stream must be stopped rather than leaving an invisible microphone on.
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      stream.getAudioTracks().forEach(track => { track.onended = () => this.leave('The microphone disconnected. Join voice again.'); });
      const reply = await this.socket.timeout(5000).emitWithAck('voice_state', { enabled: true, muted: false });
      if (generation !== this.generation) return;
      if (!reply?.ok) throw new Error('Could not join voice. Re-enter your saved name and try again.');
      this.updateState({ enabled: true, muted: false, busy: false });
      this.timer = setInterval(() => this.reconcile(), 100);
      this.reconcile();
      for (const signal of this.pendingSignals.splice(0)) this.receiveSignal(signal);
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser and try again.'
        : error.name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.'
          : error.message || 'Could not start voice.';
      this.leave(message);
    }
  }

  leave(error = '') {
    ++this.generation;
    clearInterval(this.timer);
    this.abort?.abort();
    for (const id of this.peers.keys()) this.closePeer(id);
    this.failedPeers.clear();
    this.pendingSignals.length = 0;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    this.context?.close().catch(() => {}); // It may already be closed during browser teardown.
    this.context = null;
    if (this.socket.connected) this.socket.emit('voice_state', { enabled: false, muted: false });
    this.updateState({ enabled: false, muted: false, busy: false, connections: 0, nearby: 0, error });
  }

  toggleMute() {
    if (!this.state.enabled) return;
    const muted = !this.state.muted;
    // Disable capture transmission immediately; no new WebRTC negotiation is needed.
    this.stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
    this.updateState({ muted });
    this.socket.emit('voice_state', { enabled: true, muted });
  }

  reconcile() {
    if (!this.state.enabled) return;
    const position = this.getPosition();
    let nearby = 0, connections = 0;
    for (const [id, entry] of this.peers) {
      const player = this.remotePlayers.get(id);
      if (!player?.voiceEnabled || playerDistance(position, player.position) > VOICE_DISCONNECT_DISTANCE) {
        this.closePeer(id);
      }
    }
    for (const [id, player] of this.remotePlayers) {
      if (!player.voiceEnabled || !player.position) { this.failedPeers.delete(id); continue; }
      const distance = playerDistance(position, player.position);
      if (distance < VOICE_DISTANCE) nearby++;
      if (distance < VOICE_DISTANCE && !this.peers.has(id) && !this.failedPeers.has(id)) {
        this.createPeer(id);
      }
      const entry = this.peers.get(id);
      if (!entry) continue;
      if (entry.pc.connectionState === 'connected') connections++;
      if (entry.gain) {
        // Smooth gain changes prevent clicks when movement updates change distance.
        entry.gain.gain.setTargetAtTime(player.voiceMuted ? 0 : voiceVolume(distance), this.context.currentTime, 0.08);
      }
    }
    this.updateState({ connections, nearby });
  }

  createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry = { pc, candidates: [], queue: Promise.resolve() };
    this.peers.set(id, entry);
    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && this.isCurrent(id, entry)) this.sendSignal(id, { candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ streams, track }) => {
      if (!this.isCurrent(id, entry) || entry.source) return;
      const remote = streams[0] || new MediaStream([track]);
      // Some browsers need a playing media element to activate a remote WebRTC
      // track. Mute that element so the distance-controlled gain is the only sound.
      entry.audio = new Audio();
      entry.audio.srcObject = remote;
      entry.audio.muted = true;
      entry.audio.play().catch(() => this.failPeer(id, entry, 'The browser blocked voice playback. Leave voice and click Join Voice to retry.'));
      entry.source = this.context.createMediaStreamSource(remote);
      entry.gain = this.context.createGain();
      entry.gain.gain.value = 0;
      // Only remote audio reaches the speakers. Playing our own mic would cause feedback.
      entry.source.connect(entry.gain).connect(this.context.destination);
      this.reconcile();
    };
    const failure = () => this.failPeer(id, entry, 'Voice could not connect. This network may need a TURN relay; leave voice and rejoin to retry.');
    pc.onconnectionstatechange = () => {
      if (!this.isCurrent(id, entry)) return;
      if (pc.connectionState === 'connected') clearTimeout(entry.timeout);
      if (pc.connectionState === 'failed') failure();
      this.reconcile();
    };
    entry.timeout = setTimeout(failure, 20000);
    // Exactly one side offers, avoiding two simultaneous offers for the same pair.
    if (this.socket.id < id) {
      this.enqueue(id, entry, async () => {
        const offer = await pc.createOffer();
        if (!this.isCurrent(id, entry)) return;
        await pc.setLocalDescription(offer);
        if (this.isCurrent(id, entry)) this.sendSignal(id, { description: pc.localDescription.toJSON() });
      });
    }
    return entry;
  }

  sendSignal(id, signal) {
    if (this.socket.connected && this.state.enabled) this.socket.emit('voice_signal', { to: id, ...signal });
  }

  receiveSignal(signal) {
    // A peer's offer may arrive just before our join acknowledgement.
    if (this.state.busy && this.stream) {
      if (this.pendingSignals.length < 64) this.pendingSignals.push(signal);
      return;
    }
    if (!this.state.enabled || !signal || typeof signal.from !== 'string') return;
    const player = this.remotePlayers.get(signal.from);
    if (!player?.voiceEnabled || !player.position
      || playerDistance(this.getPosition(), player.position) > VOICE_DISCONNECT_DISTANCE
      || this.failedPeers.has(signal.from)) return;
    const entry = this.peers.get(signal.from) || this.createPeer(signal.from);
    this.enqueue(signal.from, entry, async () => {
      if (signal.description) {
        await entry.pc.setRemoteDescription(signal.description);
        if (!this.isCurrent(signal.from, entry)) return;
        // ICE may arrive before the offer/answer. Wait for the remote description.
        for (const candidate of entry.candidates.splice(0)) await entry.pc.addIceCandidate(candidate);
        if (signal.description.type === 'offer') {
          await entry.pc.setLocalDescription(await entry.pc.createAnswer());
          if (this.isCurrent(signal.from, entry)) this.sendSignal(signal.from, { description: entry.pc.localDescription.toJSON() });
        }
      } else if (signal.candidate) {
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(signal.candidate);
        else if (entry.candidates.length < 64) entry.candidates.push(signal.candidate);
      }
    });
  }

  enqueue(id, entry, operation) {
    // Serialize description/candidate operations so async packets cannot race.
    entry.queue = entry.queue.then(() => { if (this.isCurrent(id, entry)) return operation(); })
      .catch(() => this.failPeer(id, entry, 'Voice setup failed. Leave voice and rejoin to retry.'));
  }

  isCurrent(id, entry) {
    return this.state.enabled && this.peers.get(id) === entry;
  }

  failPeer(id, entry, error) {
    if (!this.isCurrent(id, entry)) return;
    this.failedPeers.add(id); // Do not retry a failed handshake ten times per second.
    this.closePeer(id);
    this.updateState({ error });
  }

  closePeer(id) {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.peers.delete(id);
    clearTimeout(entry.timeout);
    entry.pc.ontrack = entry.pc.onicecandidate = entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    entry.audio?.pause();
    if (entry.audio) entry.audio.srcObject = null;
    entry.source?.disconnect();
    entry.gain?.disconnect();
  }

  dispose() {
    this.leave();
    for (const [event, listener] of Object.entries(this.listeners)) this.socket.off(event, listener);
  }
}
