import { useState } from 'react';
import { FURNITURE_CATALOG, OBJECTS } from '../data/furniture.js';
import FurnitureIcon from './FurnitureIcon.jsx';
import Icon from './Icon.jsx';

const SEATING = new Set(['chair', 'sofa', 'chaiseLongue', 'handChair', 'plasticThrone']);
const CATEGORIES = ['All', 'Furniture', 'Seating', 'Interactive'];

export default function FurnitureEditor({
  items,
  selected,
  placement,
  placementError,
  message,
  isCentral,
  onAdd,
  onSelect,
  onMove,
  onRotate,
  onDelete,
  onScale,
  onConfigure,
  onCancel,
}) {
  // Search and tabs are UI state. The room's furniture still belongs to App.
  const [view, setView] = useState('catalog');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const active = placement?.item ?? selected;
  const query = search.trim().toLocaleLowerCase();
  const matches = (type) => {
    const entry = FURNITURE_CATALOG[type];
    return `${entry.label} ${entry.description} ${type}`.toLocaleLowerCase().includes(query);
  };
  const catalog = Object.entries(FURNITURE_CATALOG).filter(
    ([type]) =>
      matches(type) &&
      (category === 'All' ||
        (category === 'Furniture' && !OBJECTS[type]) ||
        (category === 'Seating' && SEATING.has(type)) ||
        (category === 'Interactive' && !!OBJECTS[type])),
  );
  const placed = items.filter((item) => matches(item.type));
  const count = view === 'catalog' ? catalog.length : placed.length;

  return (
    <div className={`furniture-editor ${placement ? 'is-placing' : ''}`}>
      <div className="collection-toolbar">
        <div className="collection-switch" role="group" aria-label="Furniture lists">
          <button aria-pressed={view === 'catalog'} onClick={() => setView('catalog')}>
            Catalog
          </button>
          <button aria-pressed={view === 'placed'} onClick={() => setView('placed')}>
            In room <span>{items.length}</span>
          </button>
        </div>
        <label className="inventory-search">
          <span className="sr-only">Search furniture</span>
          <Icon name="search" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              view === 'catalog' ? 'Find something for your room…' : 'Find a placed piece…'
            }
          />
        </label>
        {view === 'catalog' && (
          <div className="category-filters" role="group" aria-label="Furniture categories">
            {CATEGORIES.map((name) => (
              <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>
                {name}
              </button>
            ))}
          </div>
        )}
        <div className="collection-caption">
          <span>
            {view === 'catalog'
              ? 'Choose a piece, then click the floor'
              : 'Select a piece to rearrange or remove it'}
          </span>
          <span>{count}</span>
        </div>
      </div>
      <div
        className="collection-results"
        tabIndex={0}
        aria-label={view === 'catalog' ? 'Furniture catalog' : 'Placed furniture'}
      >
        {count === 0 ? (
          <div className="collection-empty">
            <Icon name="search" />
            <strong>{search ? 'No pieces found' : 'A fresh start'}</strong>
            <p>
              {search
                ? 'Try another name or category.'
                : 'Choose something from the catalog to make this room yours.'}
            </p>
            <button
              className="button secondary"
              onClick={() => {
                setSearch('');
                setCategory('All');
                setView('catalog');
              }}
            >
              {search ? 'Clear filters' : 'Browse catalog'}
            </button>
          </div>
        ) : view === 'catalog' ? (
          <div className="inventory">
            {catalog.map(([type, entry]) => (
              <button
                key={type}
                className={`inventory-item ${placement?.item.type === type ? 'active' : ''}`}
                onClick={() => onAdd(type)}
                aria-pressed={placement?.item.type === type}
              >
                <span className="item-art">
                  <FurnitureIcon type={type} />
                </span>
                <strong>{entry.label}</strong>
                <span>{entry.description}</span>
                <span className="item-add" aria-hidden="true">
                  +
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="placed-list">
            {placed.map((item) => {
              const entry = FURNITURE_CATALOG[item.type];
              const number =
                items
                  .filter((piece) => piece.type === item.type)
                  .findIndex((piece) => piece.id === item.id) + 1;
              return (
                <button
                  key={item.id}
                  className={`placed-item ${selected?.id === item.id ? 'active' : ''}`}
                  aria-pressed={selected?.id === item.id}
                  disabled={!!placement}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="placed-art">
                    <FurnitureIcon type={item.type} />
                  </span>
                  <span>
                    <strong>
                      {entry.label} {number}
                    </strong>
                    <small>{entry.description}</small>
                  </span>
                  <Icon name={selected?.id === item.id ? 'check' : 'arrow'} />
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* Controls are outside the scrolling list so a selection never gets buried. */}
      <div className={`selection-panel ${active ? 'has-selection' : ''}`}>
        {active ? (
          <>
            <div className="selection-heading">
              <span className="selection-art">
                <FurnitureIcon type={active.type} />
              </span>
              <div>
                <p className="eyebrow">
                  {placement
                    ? placement.mode === 'move'
                      ? 'MOVING PIECE'
                      : 'PLACING PIECE'
                    : 'SELECTED PIECE'}
                </p>
                <h3>{FURNITURE_CATALOG[active.type].label}</h3>
              </div>
              <button
                className="selection-clear"
                aria-label={placement ? 'Cancel placement' : 'Clear selection'}
                onClick={placement ? onCancel : () => onSelect(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <label className="scale-control">
              <span>
                Size <strong>{(active.scale ?? 1).toFixed(1)}×</strong>
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={active.scale ?? 1}
                onChange={(event) => onScale(+event.target.value)}
              />
            </label>
            <div className="piece-actions">
              {!placement && (
                <button className="button secondary" onClick={onMove}>
                  <Icon name="move" />
                  Move
                </button>
              )}
              <button className="button secondary" onClick={onRotate}>
                <Icon name="rotate" />
                Rotate 90°
              </button>
              {placement ? (
                <button className="button quiet" onClick={onCancel}>
                  <Icon name="close" />
                  Cancel
                </button>
              ) : (
                <button className="button danger" onClick={onDelete}>
                  <Icon name="trash" />
                  Delete
                </button>
              )}
              {!placement && OBJECTS[active.type] && (
                <button className="button secondary configure-button" onClick={onConfigure}>
                  <Icon name="settings" />
                  Configurar / usar
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="selection-hint">
            <Icon name="move" />
            Select a piece in the scene or in the room list.
          </p>
        )}
        {(message || placement) && (
          <p
            className={`editor-message ${placementError || message ? 'has-message' : 'is-valid'}`}
            aria-live="polite"
          >
            {message ||
              placementError ||
              'Click a clear spot to place. A green outline means it fits.'}
          </p>
        )}
        {isCentral && !active && (
          <details className="editor-tip">
            <summary>Living-room tips</summary>
            <p>
              Keep the hallway entrances clear. Remove unneeded pieces for a lighter scene. The
              projector follows the first plain table; removing every plain table removes it.
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
