import { useState } from 'react';
import FurnitureEditor from './ui/FurnitureEditor.jsx';
import Icon from './ui/Icon.jsx';

export default function RoomUI({
  onOpenSpaces,
  onLogout,
  loggingOut,
  authError,
  visitsOpen,
  onToggleVisits,
  isEditing,
  styleDirty = false,
  appearanceEditor,
  dirty,
  isSaving,
  saveError,
  onSave,
  onReloadLayout,
  itemCount,
  items,
  onSelect,
  selected,
  placement,
  placementError,
  message,
  onToggleEdit,
  onAdd,
  onMove,
  onRotate,
  onDelete,
  onCancel,
  onScale,
  onConfigure,
  liveStatus,
  liveConnected,
  playerCount,
  readOnly,
  seated,
  room,
  visitor,
  onTravel,
  onOpenDirectory,
  nearDoor,
  guestSyncError,
  onLocateRoom,
  targetDoor,
}) {
  const [editorTab, setEditorTab] = useState('furniture');
  const isCentral = room.id === visitor.centralRoomId;
  const isHome = room.id === visitor.personalRoomId;
  const travelBlocked = dirty || styleDirty || !!placement || isSaving;

  return (
    <div className="room-ui">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m12 3 9 5v9l-9 5-9-5V8zm0 0v10m-9-5 9 5 9-5m-9 5v9" />
            </svg>
          </span>
          <div>
            <strong>Social Rooms</strong>
            <span>A place to be together</span>
          </div>
        </div>
        <div className="header-actions">
          <span
            className={`live-status ${liveConnected ? '' : 'live-offline'}`}
            role="status"
            title={liveStatus}
          >
            <Icon name="people" />
            <span className="status-dot" />
            {liveConnected
              ? `${playerCount} ${playerCount === 1 ? 'player' : 'players'} here`
              : liveStatus}
          </span>
          <span
            className={`save-status ${saveError ? 'save-error' : ''} ${dirty ? 'save-dirty' : ''}`}
            role="status"
          >
            <span className="status-dot" />
            {readOnly
              ? isCentral
                ? 'Shared living room'
                : 'Visiting · owner decorates'
              : isSaving
                ? 'Saving…'
                : saveError
                  ? 'Save failed'
                  : dirty
                    ? 'Unsaved changes'
                    : styleDirty
                      ? 'Room style preview'
                      : 'All changes saved'}
          </span>
          {!readOnly && (isEditing || dirty) && (
            <button
              className="button secondary"
              onClick={onSave}
              disabled={readOnly || !dirty || isSaving || !!placement}
            >
              <Icon name="save" />
              {isSaving ? 'Saving…' : 'Save Room'}
            </button>
          )}
          <button
            className="button primary"
            onClick={onToggleEdit}
            disabled={readOnly || seated || styleDirty}
            title={
              readOnly
                ? 'This room is read-only.'
                : styleDirty
                  ? 'Apply or discard the room style preview first.'
                  : seated
                    ? 'Stand up before decorating.'
                    : undefined
            }
          >
            <Icon name={isEditing ? 'check' : 'edit'} />
            {isEditing ? 'Done decorating' : isCentral ? 'Edit Living Room' : 'Edit Room'}
          </button>
          <button
            className="button secondary spaces-switch"
            onClick={onOpenSpaces}
            disabled={travelBlocked}
            title={
              travelBlocked
                ? 'Save or discard changes before switching spaces.'
                : 'Create, switch or invite friends'
            }
          >
            <Icon name="rooms" />
            Spaces
          </button>
          <details className="account-menu">
            <summary title="Your account">
              {visitor.displayName || visitor.name}
              <span aria-hidden="true"> ▾</span>
            </summary>
            <div className="account-popover">
              <strong>{visitor.displayName || visitor.name}</strong>
              <span>
                @{visitor.name}
                {visitor.isHost ? ' · House host' : ''}
              </span>
              <button
                className="button secondary"
                onClick={onLogout}
                disabled={travelBlocked || loggingOut}
                title={
                  travelBlocked ? 'Save or discard your changes before logging out.' : undefined
                }
              >
                {loggingOut ? 'Logging out…' : 'Log out'}
              </button>
              {travelBlocked && <small>Save or discard changes before leaving.</small>}
              {authError && <p role="alert">{authError}</p>}
            </div>
          </details>
        </div>
      </header>

      <section className="room-heading">
        <p className="eyebrow">
          {visitor.spaceName ||
            (isCentral ? 'OUR SHARED HOUSE' : isHome ? 'YOUR COZY CORNER' : 'VISITING A BEDROOM')}
        </p>
        <h1>{isCentral ? 'Meet in the living room.' : room.name}</h1>
        <p>
          {isCentral
            ? 'Pick a seat, watch something together, and stay a little longer.'
            : !isHome
              ? 'Come in and say hello.'
              : isEditing
                ? 'A few little changes. A whole new feeling.'
                : 'Your bedroom opens onto the shared living room.'}
        </p>
        <nav className="room-navigation" aria-label="Travel between rooms">
          {!isCentral && (
            <button
              className="button secondary"
              disabled={travelBlocked}
              onClick={() => onTravel(visitor.centralRoomId)}
            >
              <Icon name="home" />
              Go to Living Room
            </button>
          )}
          <button
            className="button secondary"
            disabled={travelBlocked || isHome}
            onClick={() => onLocateRoom(visitor.personalRoomId)}
          >
            <Icon name="home" />
            Find My Door
          </button>
          <button className="button secondary" disabled={travelBlocked} onClick={onOpenDirectory}>
            <Icon name="rooms" />
            Find Bedrooms
          </button>
          {isHome && !readOnly && (
            <button className="button quiet" onClick={onToggleVisits}>
              {visitsOpen ? 'Cerrar a nuevas visitas' : 'Abrir a visitas'}
            </button>
          )}
        </nav>
        {targetDoor && (
          <p className="hall-destination" role="status">
            {targetDoor.name} · {targetDoor.wing === 'West' ? 'Left' : 'Right'} hallway · Door{' '}
            {targetDoor.bay}. Follow the gold doorway.
          </p>
        )}
        {travelBlocked && (
          <p className="travel-hint" role="status">
            Save furniture, apply or discard style changes, and finish placement before traveling.
          </p>
        )}
      </section>

      {saveError && (
        <p className="storage-warning" role="alert">
          {saveError} Your edits are still here. Try saving again.
        </p>
      )}
      {guestSyncError && (
        <p className="storage-warning" role="alert">
          Could not refresh this room: {guestSyncError}
        </p>
      )}
      {nearDoor && !isEditing && (
        <div className="door-prompt">
          <kbd>E</kbd> {isCentral ? `Enter ${nearDoor.label}` : 'Go to Living Room'}
        </div>
      )}

      {isEditing && (
        <aside className="editor-panel" aria-label="Room editor">
          <div className="editor-header">
            <div>
              <p className="eyebrow">MAKE YOURSELF AT HOME</p>
              <h2>{isCentral ? 'Our living room' : 'Your room, your way'}</h2>
            </div>
            <span className="editor-count" title="Placed furniture">
              {itemCount}
            </span>
          </div>
          {!isCentral && (
            <div className="editor-tabs" role="group" aria-label="Room editor sections">
              <button
                className={`button secondary ${editorTab === 'furniture' ? 'active' : ''}`}
                aria-pressed={editorTab === 'furniture'}
                disabled={styleDirty}
                onClick={() => setEditorTab('furniture')}
              >
                Furniture
              </button>
              {!isCentral && (
                <button
                  className={`button secondary ${editorTab === 'style' ? 'active' : ''}`}
                  aria-pressed={editorTab === 'style'}
                  disabled={!!placement}
                  onClick={() => setEditorTab('style')}
                >
                  Room style
                </button>
              )}
            </div>
          )}
          <div className="editor-content" hidden={editorTab !== 'furniture'}>
            <FurnitureEditor
              items={items}
              selected={selected}
              placement={placement}
              placementError={placementError}
              message={message}
              isCentral={isCentral}
              onAdd={onAdd}
              onSelect={onSelect}
              onMove={onMove}
              onRotate={onRotate}
              onDelete={onDelete}
              onScale={onScale}
              onConfigure={onConfigure}
              onCancel={onCancel}
            />
            <footer className="panel-footer">
              <span>
                {itemCount} pieces · {dirty ? 'Unsaved changes' : 'Saved'}
              </span>
              {isCentral && (
                <button
                  className="button quiet"
                  onClick={onReloadLayout}
                  disabled={isSaving || (!dirty && !placement && !guestSyncError && !saveError)}
                >
                  Discard edits &amp; reload
                </button>
              )}
            </footer>
          </div>
          <div className="editor-style" hidden={editorTab !== 'style'}>
            {appearanceEditor}
          </div>
        </aside>
      )}

      <footer className="bottom-bar">
        <span className="room-label">
          <span className="room-label-dot" />
          {room.name}{' '}
          <span className="room-label-detail">
            / {isCentral ? 'Shared space' : isHome ? 'Personal space' : 'Visiting'}
          </span>
        </span>
        <div className="control-hint">
          {isEditing ? (
            <>
              <span className="edit-dot" />
              {placement
                ? 'Click the floor to place · Rotate for a better fit'
                : 'Select a piece or choose from the collection'}
            </>
          ) : (
            <>
              <span className="keys">
                {['W', 'A', 'S', 'D'].map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </span>
              <span>{isCentral ? 'Walk the hallways · E at a bedroom door' : 'Walk around'}</span>
            </>
          )}
        </div>
        <span className="version-label">You: green · Guests: coral</span>
      </footer>
    </div>
  );
}
