import { useEffect, useRef, useState } from 'react';
import { loadRoomDirectory } from './api.js';

export default function RoomDirectory({ roomId, visitor, onSelectRoom, onClose }) {
  const dialog = useRef(null);
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A modal traps keyboard focus so WASD and clicks do not reach the room behind it.
    dialog.current.showModal();
    return () => dialog.current?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setRooms(null);
    setError('');
    loadRoomDirectory(controller.signal, visitor.spaceId)
      .then(setRooms)
      .catch((failure) => {
        if (failure.name !== 'AbortError') setError(failure.message);
      });
    return () => controller.abort();
  }, [attempt, visitor.spaceId]);

  return (
    <dialog
      ref={dialog}
      className="room-directory"
      aria-labelledby="directory-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="directory-header">
        <div>
          <p className="eyebrow">{visitor.spaceName || 'OUR HOUSE'}</p>
          <h2 id="directory-title">Everyone’s bedrooms.</h2>
        </div>
        <button className="button quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <p>Choose a bedroom to highlight its door, then follow the hallway from the living room.</p>
      <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>
        Refresh rooms
      </button>
      {error && <p role="alert">{error}</p>}
      {!rooms && !error && <p role="status">Finding rooms…</p>}
      <div className="directory-list">
        {rooms
          ?.filter((room) => room.id !== visitor.centralRoomId)
          .map((room) => {
            const isHome = room.id === visitor.personalRoomId;
            return (
              <button
                key={room.id}
                className="directory-room"
                disabled={room.id === roomId}
                onClick={() => onSelectRoom(room.id)}
              >
                <span className="directory-mark" aria-hidden="true">
                  {room.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{room.name}</strong>
                  <small>{isHome ? 'Your own cozy corner' : 'Open for a visit'}</small>
                </span>
                <span>{room.id === roomId ? 'You’re here' : 'Find door →'}</span>
              </button>
            );
          })}
      </div>
    </dialog>
  );
}
