import TouchMovement from './objects/TouchMovement.jsx';
import { OBJECTS } from './data/furniture.js';
import ObjectProximity from './objects/ObjectProximity.jsx';
import ObjectPanel from './objects/ObjectPanel.jsx';
import RoomAudio from './objects/RoomAudio.jsx';
import useObjectInteractions from './objects/useObjectInteractions.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import Room from './Room.jsx';
import Player from './Player.jsx';
import RemotePlayer from './RemotePlayer.jsx';
import useRoomConnection from './useRoomConnection.js';
import useProximityVoice from './useProximityVoice.js';
import VoiceControls from './VoiceControls.jsx';
import useScreenSharing from './useScreenSharing.js';
import ScreenShareControls from './ScreenShareControls.jsx';
import Projector from './Projector.jsx';
import SeatControls from './SeatControls.jsx';
import CameraController from './CameraController.jsx';
import Furniture from './Furniture.jsx';
import RoomUI from './RoomUI.jsx';
import RoomDirectory from './RoomDirectory.jsx';
import TravelDoor from './TravelDoor.jsx';
import AuthScreen from './AuthScreen.jsx';
import SpacesDialog from './SpacesDialog.jsx';
import { rememberedSpace, rememberSpace, invitationToken, clearInvitation } from './spaces.js';
import { findHallArrival, findRoomEntry } from './hallLayout.js';
import {
  loadRoom,
  saveRoom,
  saveRoomAppearance,
  requestJSON,
  loadAuthSession,
  loadSpaces,
  logout,
} from './api.js';
import { DEFAULT_APPEARANCE, validateAppearance } from './roomAppearance.js';
import { RoomBackdrop } from './RoomAppearance.jsx';
import RoomAppearancePanel from './RoomAppearancePanel.jsx';
import {
  ROOM_SIZE,
  WALL_THICKNESS,
  canWalkTo,
  clampPlacement,
  findPlayerSpawn,
  getPlacementError,
  normalizeRotation,
} from './roomLayout.js';

// A stable configuration prevents editor rerenders from resetting the camera.
const INITIAL_CAMERA = { position: [8, 11, 8], fov: 45, near: 0.1, far: 100 };

export default function App() {
  const [visitor, setVisitor] = useState(null);
  const [spaces, setSpaces] = useState(null);
  const [activeSpace, setActiveSpace] = useState(null);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [spaceError, setSpaceError] = useState('');
  const [spaceRefreshError, setSpaceRefreshError] = useState('');
  const [spaceAttempt, setSpaceAttempt] = useState(0);
  const [pendingInvitation, setPendingInvitation] = useState(() =>
    invitationToken(window.location.href),
  );
  const [roomId, setRoomId] = useState(null);
  const [arrivalFrom, setArrivalFrom] = useState(null);
  const [requestedDestination, setRequestedDestination] = useState(null);
  const [room, setRoom] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [authAttempt, setAuthAttempt] = useState(0);
  const loggingOutRef = useRef(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const enter = useCallback((user) => {
    setVisitor(user);
    setRoom(null);
    setRoomId(null);
    setSpaces(null);
    setActiveSpace(null);
    setSpacesOpen(false);
    setSpaceError('');
    setArrivalFrom(null);
    setRequestedDestination(null);
    setAuthNotice('');
    setAuthError('');
  }, []);

  useEffect(() => {
    let active = true;
    loadAuthSession()
      .then((user) => {
        if (active) enter(user);
      })
      .catch((error) => {
        if (active) setAuthError(error.message);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enter, authAttempt]);

  useEffect(() => {
    const expired = () => {
      if (loggingOutRef.current) return;
      enter(null);
      setAuthNotice('Your session ended. Log in to continue.');
      loadAuthSession().catch((error) => setAuthError(error.message));
    };
    window.addEventListener('auth-required', expired);
    return () => window.removeEventListener('auth-required', expired);
  }, [enter]);

  useEffect(() => {
    if (!visitor) return;
    const check = () =>
      loadAuthSession()
        .then((user) => {
          if (!user || user.name !== visitor.name) window.dispatchEvent(new Event('auth-required'));
        })
        .catch(() => {});
    const timer = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [visitor]);

  useEffect(() => {
    if (!visitor) return;
    const controller = new AbortController();
    setSpaceError('');
    loadSpaces(controller.signal)
      .then((list) => {
        setSpaces(list);
        const selected =
          list.find((space) => space.id === rememberedSpace(visitor.name)) || list[0];
        if (selected) {
          setActiveSpace(selected);
          setRoomId(selected.personalRoomId);
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setSpaceError(error.message);
      });
    return () => controller.abort();
  }, [visitor?.name, spaceAttempt]);

  useEffect(() => {
    if (visitor && pendingInvitation) setSpacesOpen(true);
  }, [visitor?.name, pendingInvitation]);

  useEffect(() => {
    if (!spacesOpen || !visitor) return;
    const controller = new AbortController();
    setSpaceRefreshError('');
    loadSpaces(controller.signal)
      .then(setSpaces)
      .catch((error) => {
        if (error.name !== 'AbortError') setSpaceRefreshError(error.message);
      });
    return () => controller.abort();
  }, [spacesOpen, visitor?.name]);

  function enterSpace(space) {
    // Unmount the old room so its sockets, voice and screen resources clean up before travel.
    setRoom(null);
    setArrivalFrom(null);
    setRequestedDestination(null);
    setActiveSpace(space);
    setRoomId(space.centralRoomId);
    setSpaces((current) =>
      [...(current || []).filter((item) => item.id !== space.id), space].sort(
        (a, b) => a.id - b.id,
      ),
    );
    rememberSpace(visitor.name, space.id);
    setSpacesOpen(false);
  }

  function dismissInvitation() {
    clearInvitation();
    setPendingInvitation('');
  }

  async function leaveAccount() {
    loggingOutRef.current = true;
    setLoggingOut(true);
    setAuthError('');
    try {
      await logout();
      enter(null);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      loggingOutRef.current = false;
      setLoggingOut(false);
    }
  }

  useEffect(() => {
    if (!roomId) return;
    const controller = new AbortController();
    setLoadError('');
    setRoom(null);
    loadRoom(roomId, controller.signal)
      .then(async (loaded) => {
        if (loaded.spaceId !== activeSpace?.id) {
          const list = spaces?.some((space) => space.id === loaded.spaceId)
            ? spaces
            : await loadSpaces(controller.signal);
          if (controller.signal.aborted) return;
          const target = list.find((space) => space.id === loaded.spaceId);
          if (!target) throw new Error('Join this space before visiting its rooms.');
          setSpaces(list);
          setActiveSpace(target);
          rememberSpace(visitor.name, target.id);
        }
        if (!controller.signal.aborted) setRoom(loaded);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setLoadError(error.message);
      });
    return () => controller.abort();
  }, [roomId, loadAttempt]);

  const roomVisitor = activeSpace
    ? {
        ...visitor,
        spaceId: activeSpace.id,
        spaceName: activeSpace.name,
        personalRoomId: activeSpace.personalRoomId,
        centralRoomId: activeSpace.centralRoomId,
        roomName: activeSpace.roomName,
        isHost: activeSpace.isHost,
      }
    : visitor;

  const spacesDialog = spaces && (
    <SpacesDialog
      refreshError={spaceRefreshError}
      spaces={spaces}
      currentSpace={activeSpace}
      pendingInvitation={pendingInvitation}
      onDismissInvitation={dismissInvitation}
      onEntered={enterSpace}
      onClose={() => setSpacesOpen(false)}
      standalone={!activeSpace}
      onLogout={leaveAccount}
      loggingOut={loggingOut}
    />
  );

  if (authLoading || (!visitor && authError))
    return (
      <main className="connection-screen">
        <section className="connection-card">
          <h1>{authError ? 'Could not connect.' : 'Opening Social Rooms…'}</h1>
          <p role={authError ? 'alert' : 'status'}>{authError || 'Checking your saved session.'}</p>
          {authError && (
            <button
              className="button primary"
              onClick={() => {
                setAuthError('');
                setAuthLoading(true);
                setAuthAttempt((attempt) => attempt + 1);
              }}
            >
              Try again
            </button>
          )}
        </section>
      </main>
    );
  if (!visitor)
    return (
      <AuthScreen
        onEnter={enter}
        notice={
          authNotice ||
          (pendingInvitation
            ? 'You’ve been invited to a space. Log in or create an account to accept.'
            : '')
        }
      />
    );

  if (spaces === null || spaceError)
    return (
      <main className="connection-screen">
        <section className="connection-card">
          <h1>{spaceError ? 'Could not load your spaces.' : 'Finding your spaces…'}</h1>
          <p role={spaceError ? 'alert' : 'status'}>{spaceError || 'Checking your memberships.'}</p>
          {spaceError && (
            <button
              className="button primary"
              onClick={() => setSpaceAttempt((value) => value + 1)}
            >
              Try again
            </button>
          )}
        </section>
      </main>
    );
  if (!activeSpace) return spacesDialog;

  if (!room) {
    return (
      <main className="connection-screen">
        <div className="connection-card">
          <p className="eyebrow">SOCIAL ROOMS</p>
          <h1>
            {loadError
              ? 'This space could not be loaded.'
              : roomId === roomVisitor?.centralRoomId
                ? 'Opening the living room…'
                : 'Opening your bedroom…'}
          </h1>
          <p role={loadError ? 'alert' : 'status'}>
            {loadError ||
              (roomId === roomVisitor?.centralRoomId
                ? 'Loading the living room, cozy hallways, and bedroom doors.'
                : 'Loading the saved furniture from the room server.')}
          </p>
          {loadError && (
            <button
              className="button primary"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Try again
            </button>
          )}
          {loadError && visitor && roomId !== roomVisitor.personalRoomId && (
            <button
              className="button secondary"
              onClick={() => setRoomId(roomVisitor.personalRoomId)}
            >
              Return to My Room
            </button>
          )}
        </div>
      </main>
    );
  }
  // Mount only after GET succeeds: the player must spawn against the loaded furniture.
  // A new room gets fresh furniture/editor/player state and a fresh live connection.
  return (
    <>
      <RoomEditor
        key={room.id}
        room={room}
        visitor={roomVisitor}
        onOpenSpaces={() => setSpacesOpen(true)}
        spacesOpen={spacesOpen}
        onLogout={leaveAccount}
        loggingOut={loggingOut}
        authError={authError}
        arrivalFrom={arrivalFrom}
        requestedDestination={requestedDestination}
        onTravel={(nextId, destination = null) => {
          setArrivalFrom(room.id);
          setRequestedDestination(destination);
          setRoom(null);
          setRoomId(nextId);
        }}
      />
      {spacesOpen && spacesDialog}
    </>
  );
}

function RoomEditor({
  onOpenSpaces,
  spacesOpen,
  room,
  visitor,
  onTravel,
  arrivalFrom,
  requestedDestination,
  onLogout,
  loggingOut,
  authError,
}) {
  const isCentral = room.id === visitor.centralRoomId;
  const [roomStyle, setRoomStyle] = useState(() => ({
    appearance: room.appearance ?? structuredClone(DEFAULT_APPEARANCE),
    revision: room.appearanceRevision ?? 0,
  }));
  const [appearancePreview, setAppearancePreview] = useState(null);
  const styleDirty = appearancePreview !== null;
  const visibleAppearance = appearancePreview ?? roomStyle.appearance;
  const applyAppearance = useCallback((update) => {
    setRoomStyle((current) =>
      update.revision >= current.revision
        ? { appearance: update.appearance, revision: update.revision }
        : current,
    );
  }, []);
  const [visitsOpen, setVisitsOpen] = useState(room.isOpen ?? true);
  const [hall, setHall] = useState(room.hall ?? null);
  const [targetRoomId, setTargetRoomId] = useState(requestedDestination);
  const [items, setItems] = useState(room.items);
  const [savedItems, setSavedItems] = useState(room.items);
  const savedLayoutVersion = useRef(room.layoutVersion);
  const pendingLayout = useRef(null);
  const [activeObjectId, setActiveObjectId] = useState(null);
  const [panelMode, setPanelMode] = useState('use');
  const [nearObjectId, setNearObjectId] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [volumes, setVolumes] = useState({});
  const [ambientVolume, setAmbientVolume] = useState(0.2);
  const [audioError, setAudioError] = useState('');
  const [motionPaused, setMotionPaused] = useState(false);
  const applyObjectUpdates = useCallback((updates) => {
    const byId = new Map(updates.map((item) => [item.id, item]));
    const merge = (current) =>
      current.map((item) => {
        const update = byId.get(item.id);
        // Preserve unsaved floor edits; only the server-owned configuration/state changes here.
        return update && update.type === item.type && (update.revision ?? 0) >= (item.revision ?? 0)
          ? {
              ...item,
              config: update.config ?? {},
              state: update.state ?? {},
              revision: update.revision ?? 0,
            }
          : item;
      });
    setItems(merge);
    setSavedItems(merge);
  }, []);
  const [spawnPosition] = useState(() =>
    isCentral
      ? findHallArrival(room.hall, arrivalFrom)
      : arrivalFrom === visitor.centralRoomId
        ? findRoomEntry(room.items)
        : findPlayerSpawn(room.items),
  );
  const live = useRoomConnection(room.id, spawnPosition);
  const interactions = useObjectInteractions(live.socketRef, room.id, applyObjectUpdates);
  const voice = useProximityVoice(live.socketRef, live.latestPose);
  const screen = useScreenSharing(live.socketRef, isCentral);
  const [nearProjector, setNearProjector] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [placement, setPlacement] = useState(null);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [guestSyncError, setGuestSyncError] = useState('');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [nearDoor, setNearDoor] = useState(null);
  const doors = useMemo(
    () =>
      isCentral
        ? hall.doors.map((door) => ({
            ...door,
            label: door.name,
            isHome: door.roomId === visitor.personalRoomId,
          }))
        : [
            {
              roomId: visitor.centralRoomId,
              label: 'Living room',
              position: [0, 0, 4.6],
              rotation: 0,
            },
          ],
    [hall, isCentral, visitor.centralRoomId, visitor.personalRoomId],
  );
  const walkAreas = isCentral ? hall.walkAreas : undefined;
  const targetDoor = isCentral ? doors.find((door) => door.roomId === targetRoomId) : null;
  const camera = useMemo(
    () => ({
      ...INITIAL_CAMERA,
      far: 1000,
      position: [spawnPosition[0] + 8, 11, spawnPosition[2] + 8],
    }),
    [spawnPosition, isCentral],
  );
  const layoutData = (list) =>
    list.map(({ id, type, position, rotation, scale }) => ({
      id,
      type,
      position,
      rotation,
      scale: scale ?? 1,
    }));
  const dirty = JSON.stringify(layoutData(items)) !== JSON.stringify(layoutData(savedItems));
  // Live reloads consult current edits without restarting their timer on every placement.
  pendingLayout.current = { dirty, placement, isSaving };
  const projectorTable = useMemo(
    () =>
      items
        .filter((item) => item.type === 'table')
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0],
    [items],
  );
  const activeObject = items.find((item) => item.id === activeObjectId);
  const nearObject = items.find((item) => item.id === nearObjectId);
  const litObjects = items
    .filter(
      (item) =>
        item.type === 'lamp' ||
        item.type === 'aquarium' ||
        (['coneLamp', 'discoBall'].includes(item.type) && item.state?.active),
    )
    .slice(0, 6)
    .map((item) => item.id);
  const savingRef = useRef(false);
  const playerRef = useRef(null);
  const touchInput = useRef({});
  const selected = items.find((item) => item.id === selectedId);
  const travelBlocked = dirty || styleDirty || !!placement || isSaving;
  const placementError = placement
    ? getPlacementError(placement.item, items, playerRef.current?.position, isCentral)
    : null;

  useEffect(() => {
    const socket = live.socketRef.current;
    const receive = (update) => {
      if (update.roomId !== room.id) return;
      try {
        validateAppearance(update.appearance);
        if (!Number.isSafeInteger(update.revision) || update.revision < 0)
          throw new Error('Invalid room style revision.');
        applyAppearance(update);
      } catch (error) {
        setGuestSyncError(error.message);
      }
    };
    socket?.on('room_appearance', receive);
    return () => socket?.off('room_appearance', receive);
  }, [live.socketRef, room.id, applyAppearance]);

  useEffect(() => {
    if (!room.readOnly && !isCentral) return;
    const controller = new AbortController();
    // Guests reload saved records through HTTP after a live notification.
    async function refresh() {
      try {
        const latest = await loadRoom(room.id, controller.signal);
        if (controller.signal.aborted) return;
        if (isCentral) setHall(latest.hall);
        const pending = pendingLayout.current;
        if (!room.readOnly && (pending.dirty || pending.placement || pending.isSaving)) {
          // Update bedroom doors even while decorating, but never overwrite a host's draft.
          if (!pending.isSaving && latest.layoutVersion !== savedLayoutVersion.current)
            setGuestSyncError('The living room changed. Discard edits and reload before saving.');
          return;
        }
        setItems(latest.items);
        setSavedItems(latest.items);
        savedLayoutVersion.current = latest.layoutVersion;
        if (latest.appearance)
          applyAppearance({ appearance: latest.appearance, revision: latest.appearanceRevision });
        setGuestSyncError('');
        const player = playerRef.current?.position;
        if (
          player &&
          !live.postureRef.current?.seated &&
          !canWalkTo(player.x, player.z, latest.items, latest.hall?.walkAreas)
        ) {
          // If the owner placed furniture where a guest stands, move them to a clear spot.
          player.set(...findPlayerSpawn(latest.items));
        }
      } catch (error) {
        if (error.name !== 'AbortError') setGuestSyncError(error.message);
      }
    }
    refresh();
    // Polling also catches room creations on another local server sharing this DB.
    const timer = isCentral ? window.setInterval(refresh, 15000) : null;
    return () => {
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [room.id, room.readOnly, live.layoutRevision, isCentral, applyAppearance]);

  function openDirectory() {
    if (!travelBlocked) setDirectoryOpen(true);
  }

  function enterDoor(nextRoomId) {
    if (travelBlocked || isEditing || directoryOpen) return;
    onTravel(nextRoomId);
  }

  function locateRoom(nextRoomId) {
    if (travelBlocked) return;
    setDirectoryOpen(false);
    if (isCentral) setTargetRoomId(nextRoomId);
    else onTravel(visitor.centralRoomId, nextRoomId);
  }

  useEffect(() => {
    if (!dirty && !styleDirty) return;
    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty, styleDirty]);

  async function handleSave() {
    if (room.readOnly || !dirty || placement || savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setSaveError('');
    // Keep this snapshot: newer edits made during the request must stay unsaved.
    const snapshot = items;
    try {
      const result = await saveRoom(room.id, snapshot, savedLayoutVersion.current);
      savedLayoutVersion.current = result.layoutVersion;
      setSavedItems(snapshot);
      setGuestSyncError('');
    } catch (error) {
      setSaveError(error.message);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  async function reloadLayout() {
    if (savingRef.current) return;
    try {
      const latest = await loadRoom(room.id);
      setItems(latest.items);
      setSavedItems(latest.items);
      savedLayoutVersion.current = latest.layoutVersion;
      if (isCentral) setHall(latest.hall);
      setSelectedId(null);
      setPlacement(null);
      setSaveError('');
      setGuestSyncError('');
      setMessage('Saved layout restored.');
    } catch (error) {
      setSaveError(error.message);
    }
  }

  function toggleEditMode() {
    if (room.readOnly || live.posture?.seated || styleDirty) return;
    setIsEditing((editing) => !editing);
    setSelectedId(null);
    setPlacement(null);
    setMessage('');
    setActiveObjectId(null);
  }

  function beginPlacement(type) {
    setSelectedId(null);
    setPlacement({
      mode: 'add',
      item: {
        id: crypto.randomUUID(),
        type,
        position: [0, 0, 0],
        rotation: 0,
        ...(OBJECTS[type] ? { config: structuredClone(OBJECTS[type].defaults) } : {}),
      },
    });
    setMessage('');
  }

  function movePreview(point) {
    if (!placement) return;
    setPlacement((current) =>
      current
        ? {
            ...current,
            item: {
              ...current.item,
              position: clampPlacement(current.item, point),
            },
          }
        : null,
    );
    setMessage('');
  }

  function handleFloorClick(point) {
    if (!placement) {
      setSelectedId(null);
      setMessage('');
      return;
    }
    const candidate = {
      ...placement.item,
      position: clampPlacement(placement.item, point),
    };
    const error = getPlacementError(candidate, items, playerRef.current?.position, isCentral);
    if (error) {
      setMessage(error);
      return;
    }
    setItems((current) =>
      placement.mode === 'add'
        ? [...current, candidate]
        : current.map((item) => (item.id === candidate.id ? candidate : item)),
    );
    setSelectedId(candidate.id);
    setPlacement(null);
    setMessage('');
  }

  function selectFurniture(id) {
    setSelectedId(id);
    setMessage('');
  }

  function beginMove() {
    if (!selected) return;
    setPlacement({
      mode: 'move',
      item: { ...selected, position: [...selected.position] },
    });
    setMessage('');
  }

  function rotateFurniture() {
    const item = placement?.item ?? selected;
    if (!item) return;
    const rotated = {
      ...item,
      rotation: normalizeRotation(item.rotation + Math.PI / 2),
    };
    if (placement) {
      rotated.position = clampPlacement(rotated, rotated.position);
      setPlacement({ ...placement, item: rotated });
      setMessage('');
      return;
    }
    const error = getPlacementError(rotated, items, playerRef.current?.position, isCentral);
    if (error) {
      setMessage(error + ' Try moving the piece first.');
      return;
    }
    setItems((current) => current.map((piece) => (piece.id === rotated.id ? rotated : piece)));
    setMessage('');
  }

  function scaleFurniture(scale) {
    const item = placement?.item ?? selected;
    if (!item) return;
    const candidate = { ...item, scale };
    if (placement) {
      candidate.position = clampPlacement(candidate, candidate.position);
      setPlacement({ ...placement, item: candidate });
      return;
    }
    const error = getPlacementError(candidate, items, playerRef.current?.position, isCentral);
    if (error) {
      setMessage(error);
      return;
    }
    setItems((current) => current.map((piece) => (piece.id === item.id ? candidate : piece)));
  }

  function openObject(id, mode = 'use') {
    const item = items.find((piece) => piece.id === id);
    if (!item || directoryOpen || screen.viewing || placement) return;
    const position = playerRef.current?.position;
    const info = OBJECTS[item.type];
    if (
      mode === 'use' &&
      position &&
      Math.hypot(position.x - item.position[0], position.z - item.position[2]) >
        1.9 + (Math.max(info.width, info.depth) * (item.scale ?? 1)) / 2
    ) {
      setMessage('Acércate al objeto para interactuar.');
      return;
    }
    setPanelMode(mode);
    setActiveObjectId(id);
    setMessage('');
  }

  function deleteFurniture() {
    if (!selected) return;
    setItems((current) => current.filter((item) => item.id !== selected.id));
    setSelectedId(null);
    setPlacement(null);
    setMessage('');
  }

  return (
    <main className={`app ${isEditing ? 'editing' : ''} ${placement ? 'placing' : ''}`}>
      <div className="scene" aria-label="Your 3D room">
        <Canvas
          shadows
          camera={camera}
          dpr={[1, 1.5]}
          fallback={
            <div className="canvas-fallback">This room needs a browser with WebGL enabled.</div>
          }
          onPointerMissed={() => {
            if (isEditing && !placement) setSelectedId(null);
          }}
        >
          <RoomBackdrop
            config={isCentral ? DEFAULT_APPEARANCE.background : visibleAppearance.background}
          />
          <ambientLight intensity={0.8} />
          <directionalLight
            position={[-3, 8, 5]}
            color="#fff1d4"
            intensity={2.2}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0005}
            shadow-normalBias={0.035}
            shadow-camera-left={-8}
            shadow-camera-right={8}
            shadow-camera-top={8}
            shadow-camera-bottom={-8}
            shadow-camera-far={25}
          />
          <Room
            size={ROOM_SIZE}
            wallThickness={WALL_THICKNESS}
            isEditing={isEditing}
            isCentral={isCentral}
            hall={hall}
            appearance={visibleAppearance}
            onFloorMove={movePreview}
            onFloorClick={handleFloorClick}
          />
          {isCentral && projectorTable && (
            <Projector
              screen={screen}
              connected={live.connected}
              table={projectorTable}
              isEditing={isEditing}
              onSelect={
                isEditing && !placement ? () => selectFurniture(projectorTable.id) : undefined
              }
              playerRef={playerRef}
              nearby={nearProjector}
              onNearChange={setNearProjector}
              seated={!!live.posture?.seated}
            />
          )}
          {items
            .filter((item) => !(placement?.mode === 'move' && placement.item.id === item.id))
            .map((item) => (
              <Furniture
                key={item.id}
                item={item}
                cozy={isCentral}
                selected={isEditing && item.id === selectedId}
                onSelect={isEditing && !placement ? selectFurniture : undefined}
                onInteract={!isEditing && OBJECTS[item.type] ? openObject : undefined}
                playerRef={playerRef}
                peers={live.peers}
                lights={litObjects.includes(item.id)}
                motionPaused={motionPaused}
                onFish={!isEditing ? (name) => setMessage(`Pez: ${name}`) : undefined}
              />
            ))}
          {placement && <Furniture item={placement.item} preview valid={!placementError} />}
          <ObjectProximity
            items={items}
            playerRef={playerRef}
            enabled={
              !spacesOpen && !isEditing && !directoryOpen && !activeObject && !screen.viewing
            }
            onNear={setNearObjectId}
            onOpen={openObject}
            onStep={(item) => interactions.action(item, 'step').catch(() => {})}
          />
          <SeatControls
            items={items}
            playerRef={playerRef}
            peers={live.peers}
            posture={live.posture}
            onSit={live.sit}
            onStand={live.stand}
            enabled={
              !spacesOpen &&
              !isEditing &&
              !directoryOpen &&
              !activeObject &&
              !travelBlocked &&
              !screen.viewing
            }
            connected={live.connected}
            pending={live.seatPending}
            error={live.seatError}
          />
          <TravelDoor
            doors={doors}
            playerRef={playerRef}
            enabled={
              !spacesOpen &&
              !isEditing &&
              !directoryOpen &&
              !activeObject &&
              !nearObjectId &&
              !travelBlocked &&
              !screen.viewing &&
              !live.posture?.seated
            }
            nearby={nearDoor}
            onNearChange={setNearDoor}
            onEnter={enterDoor}
            targetRoomId={targetRoomId}
          />
          <Player
            playerRef={playerRef}
            touchInput={touchInput}
            enabled={
              !spacesOpen && !isEditing && !directoryOpen && !activeObject && !screen.viewing
            }
            items={items}
            spawnPosition={spawnPosition}
            onPose={live.publishPose}
            walkAreas={walkAreas}
            posture={live.posture}
            name={live.name || visitor.roomName.replace(/’s bedroom$/, '')}
            voiceEnabled={voice.enabled}
            voiceMuted={voice.muted}
          />
          {live.peers.map((player) => (
            <RemotePlayer key={player.id} player={player} />
          ))}
          <CameraController
            playerRef={playerRef}
            isEditing={isEditing}
            isCentral={isCentral}
            spawnPosition={spawnPosition}
          />
        </Canvas>
      </div>
      <RoomUI
        onOpenSpaces={onOpenSpaces}
        items={items}
        onSelect={selectFurniture}
        onReloadLayout={reloadLayout}
        isEditing={isEditing}
        styleDirty={styleDirty}
        appearanceEditor={
          <RoomAppearancePanel
            roomId={room.id}
            appearance={roomStyle.appearance}
            revision={roomStyle.revision}
            onPreview={setAppearancePreview}
            onSave={async (appearance, revision) => {
              const result = await saveRoomAppearance(room.id, appearance, revision);
              applyAppearance(result);
              return result;
            }}
            onReload={async () => {
              const latest = await loadRoom(room.id);
              const result = { appearance: latest.appearance, revision: latest.appearanceRevision };
              applyAppearance(result);
              return result;
            }}
          />
        }
        dirty={dirty}
        isSaving={isSaving}
        saveError={saveError}
        readOnly={room.readOnly === true}
        seated={!!live.posture?.seated}
        room={room}
        visitor={visitor}
        onLogout={onLogout}
        loggingOut={loggingOut}
        authError={authError}
        visitsOpen={visitsOpen}
        onToggleVisits={async () => {
          try {
            const result = await requestJSON(`/api/rooms/${room.id}/access`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isOpen: !visitsOpen }),
            });
            setVisitsOpen(result.isOpen);
          } catch (error) {
            setMessage(error.message);
          }
        }}
        onTravel={onTravel}
        onOpenDirectory={openDirectory}
        nearDoor={nearDoor}
        guestSyncError={guestSyncError}
        onLocateRoom={locateRoom}
        targetDoor={targetDoor}
        liveStatus={live.status}
        liveConnected={live.connected}
        playerCount={live.peers.length + 1}
        onSave={handleSave}
        itemCount={items.length}
        selected={selected}
        placement={placement}
        placementError={placementError}
        message={message}
        onToggleEdit={toggleEditMode}
        onAdd={beginPlacement}
        onMove={beginMove}
        onRotate={rotateFurniture}
        onDelete={deleteFurniture}
        onScale={scaleFurniture}
        onConfigure={() => selected && openObject(selected.id, 'configure')}
        onCancel={() => {
          setPlacement(null);
          setMessage('');
        }}
      />
      {directoryOpen && (
        <RoomDirectory
          roomId={room.id}
          visitor={visitor}
          onSelectRoom={locateRoom}
          onClose={() => setDirectoryOpen(false)}
        />
      )}
      {nearObject && !isEditing && !activeObject && (
        <button className="button primary object-context" onClick={() => openObject(nearObject.id)}>
          <kbd>E</kbd> {OBJECTS[nearObject.type].description}
        </button>
      )}
      {!isEditing && message && (
        <p className="object-toast" role="status">
          {message}
          <button aria-label="Cerrar aviso" onClick={() => setMessage('')}>
            ×
          </button>
        </p>
      )}
      {activeObject && (
        <ObjectPanel
          key={activeObject.id}
          item={activeObject}
          roomId={room.id}
          owner={!room.readOnly}
          mode={panelMode}
          saved={savedItems.some((item) => item.id === activeObject.id)}
          interactions={interactions}
          live={live}
          onClose={() => setActiveObjectId(null)}
          onTravel={enterDoor}
          audioEnabled={audioEnabled}
          onAudioEnabled={setAudioEnabled}
          volume={volumes[activeObject.id] ?? 0.35}
          onVolume={(volume) =>
            setVolumes((current) => ({ ...current, [activeObject.id]: volume }))
          }
          ambientVolume={ambientVolume}
          onAmbientVolume={setAmbientVolume}
          motionPaused={motionPaused}
          onMotionPaused={setMotionPaused}
        />
      )}
      <TouchMovement
        inputRef={touchInput}
        enabled={
          !spacesOpen &&
          !isEditing &&
          !directoryOpen &&
          !activeObject &&
          !screen.viewing &&
          !live.posture?.seated
        }
      />
      <RoomAudio
        items={items}
        enabled={audioEnabled}
        volumes={volumes}
        ambientVolume={ambientVolume}
        onError={setAudioError}
        onEnded={(item, ended) =>
          interactions
            .action(item, 'pause', { ended })
            .catch((error) => setAudioError(error.message))
        }
      />
      {audioError && (
        <p className="object-toast" role="alert">
          {audioError}
          <button aria-label="Cerrar error" onClick={() => setAudioError('')}>
            ×
          </button>
        </p>
      )}
      <VoiceControls voice={voice} connected={live.connected} />
      {isCentral && (
        <ScreenShareControls
          screen={screen}
          nearby={!isEditing && !!projectorTable && nearProjector}
        />
      )}
    </main>
  );
}
