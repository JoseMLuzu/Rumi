import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getCsrfToken, loadAuthSession } from './api.js';

export default function useRoomConnection(roomId, spawnPosition) {
  const [peers, setPeers] = useState({});
  const [status, setStatus] = useState('Connecting to live room…');
  const [connected, setConnected] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [name, setName] = useState(null);
  const [posture, setPosture] = useState(null);
  const [seatPending, setSeatPending] = useState(false);
  const [seatError, setSeatError] = useState('');
  const socketRef = useRef(null);
  const latestPose = useRef({ position: [...spawnPosition], rotation: 0 });
  const lastSent = useRef(null);
  const lastSentAt = useRef(0);
  const postureRef = useRef(null);
  const standingPose = useRef(latestPose.current);
  const pendingSeat = useRef(false);
  const seatRequest = useRef(0);

  const applyPosture = useCallback((player) => {
    const next = { ...player, seated: !!player.seated, seatHeight: player.seatHeight ?? 0 };
    postureRef.current = next;
    latestPose.current = { position: [...player.position], rotation: player.rotation };
    if (!next.seated) standingPose.current = latestPose.current;
    lastSent.current = null;
    setPosture(next);
  }, []);

  const requestPosture = useCallback(
    (event, data = {}) => {
      const socket = socketRef.current;
      if (!socket?.connected || pendingSeat.current) return;
      pendingSeat.current = true;
      setSeatPending(true);
      setSeatError('');
      const request = ++seatRequest.current;
      socket.timeout(4000).emit(event, data, (error, response) => {
        // Ignore an old acknowledgement after a disconnect or a newer interaction.
        if (request !== seatRequest.current) return;
        pendingSeat.current = false;
        setSeatPending(false);
        if (error || !response?.ok)
          setSeatError(
            error
              ? 'The seat request timed out. Try again.'
              : response?.error || 'That seat is unavailable.',
          );
        else if (response.player) applyPosture(response.player);
      });
    },
    [applyPosture],
  );

  const sit = useCallback(
    (seat) => requestPosture('player_sit', { itemId: seat.itemId, slot: seat.slot }),
    [requestPosture],
  );
  const stand = useCallback(() => requestPosture('player_stand'), [requestPosture]);

  useEffect(() => {
    const socket = io({
      autoConnect: false,
      transports: ['websocket'],
      // Reconnection gets the current pose, rather than replaying an old spawn position.
      auth: (done) => done({ roomId, csrfToken: getCsrfToken(), ...latestPose.current }),
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setStatus('Live room connected');
      lastSent.current = null;
      // Refresh a guest's layout after reconnecting: saves may have happened offline.
      setLayoutRevision((revision) => revision + 1);
    });
    socket.on('room_layout_changed', (data) => {
      if (data.roomId === roomId) {
        setLayoutRevision((revision) => revision + 1);
        // The server rejects edits to occupied seats; unrelated decoration keeps people seated.
      }
    });
    socket.on('hall_changed', (data) => {
      if (data.roomId === roomId) setLayoutRevision((revision) => revision + 1);
    });
    socket.on('room_state', ({ players }) => {
      const ownPlayer = players.find((player) => player.id === socket.id);
      setName(ownPlayer?.name ?? null);
      if (ownPlayer) applyPosture(ownPlayer);
      setPeers(
        Object.fromEntries(
          players.filter((player) => player.id !== socket.id).map((player) => [player.id, player]),
        ),
      );
    });
    const updatePeer = (player) => {
      if (player.id !== socket.id)
        setPeers((current) => ({ ...current, [player.id]: { ...current[player.id], ...player } }));
    };
    socket.on('player_joined', updatePeer);
    socket.on('player_moved', updatePeer);
    socket.on('player_voice_changed', updatePeer);
    socket.on('player_posture_changed', (player) => {
      if (player.id === socket.id) applyPosture(player);
      else updatePeer(player);
    });
    socket.on('player_left', ({ id }) => {
      setPeers((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    });
    socket.on('disconnect', () => {
      // The server releases the seat. Reconnect from the last walking pose, not inside a chair.
      seatRequest.current++;
      pendingSeat.current = false;
      setSeatPending(false);
      if (postureRef.current?.seated) applyPosture({ ...standingPose.current, seated: false });
      setConnected(false);
      setPeers({});
      setStatus('Live room disconnected — reconnecting…');
    });
    socket.on('auth_expired', () => window.dispatchEvent(new Event('auth-required')));
    socket.on('connect_error', () => {
      loadAuthSession()
        .then((user) => {
          if (!user) window.dispatchEvent(new Event('auth-required'));
        })
        .catch(() => {});
      setConnected(false);
      setPeers({});
      setStatus('Live room unavailable — retrying…');
    });
    socket.connect();
    return () => {
      // StrictMode also runs this cleanup; never leave a duplicate player connection.
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, applyPosture, requestPosture]);

  const publishPose = useCallback((position, rotation) => {
    if (postureRef.current?.seated) return;
    const pose = { position: [position.x, 0, position.z], rotation };
    latestPose.current = pose;
    standingPose.current = pose;
    const socket = socketRef.current;
    const now = performance.now();
    if (!socket?.connected || now - lastSentAt.current < 50) return;
    const previous = lastSent.current;
    if (
      previous &&
      previous.position[0] === pose.position[0] &&
      previous.position[2] === pose.position[2] &&
      previous.rotation === rotation
    )
      return;
    // Render every frame locally, but send at most 20 updates/sec to reduce network traffic.
    // The connected check above avoids queuing movement while the server is offline.
    socket.emit('player_move', pose);
    lastSent.current = pose;
    lastSentAt.current = now;
  }, []);

  return {
    peers: Object.values(peers),
    connected,
    status,
    publishPose,
    layoutRevision,
    name,
    posture,
    postureRef,
    sit,
    stand,
    seatPending,
    seatError,
    socketRef,
    latestPose,
  };
}
