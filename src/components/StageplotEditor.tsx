import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, PenLine, Plus, Trash2, Map, RotateCw, Maximize2 } from 'lucide-react';
import type { SongHandNoteDocument, Stageplot, StageplotItem } from '../types';
import { showConfirmToast } from '../utils/toastDialogs';
import { generateId } from '../lib/uuid';
import toast from '../utils/anchoredToast';
import {
  stageplotIconForKind,
  stageplotItemDisplayScale,
  stageplotItemBadge,
  stageplotItemBadgeCorner,
  stageplotIsOutputKind,
  compareStageplotItemsByChannel,
  STAGEPLOT_ITEM_SCALE_MIN,
  STAGEPLOT_ITEM_SCALE_MAX,
} from '../lib/stageplotIcons';
import { TECH_RIDER_ICON_OPTIONS } from '../lib/iconOptions';
import { clamp01 } from '../lib/lineAnchor';

interface StageplotEditorProps {
  stageplot: Stageplot;
  canEdit: boolean;
  showHeader?: boolean;
  toolbarPortalTarget?: HTMLElement | null;
  onRename: (name: string) => void;
  onUpdateIcon: (icon?: string) => void;
  onDelete: () => Promise<void>;
  onSaveContent: (items: StageplotItem[], drawingLayers: SongHandNoteDocument[]) => Promise<void>;
  onCopyPublicLink: () => Promise<void>;
}

const ITEM_DRAG_MIME = 'application/x-gigboy-stageplot-item-template';
const CUSTOM_ITEM_TEMPLATE = { kind: 'custom', label: 'Custom item', color: '#6b7280' } as const;

// Cycled through for items added via a palette click (rather than dragged to
// an exact spot), so repeated clicks land near the center without stacking
// exactly on top of each other.
const CLICK_ADD_OFFSETS: Array<{ dx: number; dy: number }> = [
  { dx: 0, dy: 0 },
  { dx: 0.05, dy: 0.04 },
  { dx: -0.05, dy: 0.06 },
  { dx: 0.06, dy: -0.05 },
  { dx: -0.06, dy: -0.04 },
  { dx: 0.03, dy: 0.08 },
  { dx: -0.03, dy: -0.08 },
];

interface PaletteItem {
  kind: string;
  label: string;
  color: string;
}

interface PaletteCategory {
  name: string;
  items: PaletteItem[];
}

const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    name: 'Instruments',
    items: [
      { kind: 'vocals', label: 'Vocals', color: '#f97316' },
      { kind: 'guitar', label: 'Guitar', color: '#22c55e' },
      { kind: 'bass', label: 'Bass', color: '#0ea5e9' },
      { kind: 'drums', label: 'Drums', color: '#ef4444' },
      { kind: 'keys', label: 'Keys', color: '#a855f7' },
      { kind: 'violin', label: 'Violin', color: '#d946ef' },
      { kind: 'trumpet', label: 'Trumpet', color: '#ea580c' },
      { kind: 'saxophone', label: 'Saxophone', color: '#dc2626' },
    ],
  },
  {
    name: 'Drum Kit',
    items: [
      { kind: 'drum-kick', label: 'Kick', color: '#ef4444' },
      { kind: 'drum-snare', label: 'Snare', color: '#f43f5e' },
      { kind: 'drum-hihat', label: 'Hi-Hat', color: '#fb7185' },
      { kind: 'drum-rack-tom', label: 'Rack Tom', color: '#e11d48' },
      { kind: 'drum-floor-tom', label: 'Floor Tom', color: '#be123c' },
      { kind: 'drum-crash', label: 'Crash', color: '#fb923c' },
      { kind: 'drum-ride', label: 'Ride', color: '#c2410c' },
      { kind: 'drum-overhead', label: 'Overhead', color: '#9f1239' },
    ],
  },
  {
    name: 'Speakers & Amps',
    items: [
      { kind: 'monitor', label: 'Monitor', color: '#f59e0b' },
      { kind: 'pa', label: 'PA', color: '#059669' },
      { kind: 'subs', label: 'Subs', color: '#1e40af' },
      { kind: 'iem', label: 'IEM', color: '#7c3aed' },
      { kind: 'amp', label: 'Amp', color: '#6b7280' },
      { kind: 'guitar-amp', label: 'Guitar Amp', color: '#14b8a6' },
      { kind: 'bass-amp', label: 'Bass Amp', color: '#06b6d4' },
      { kind: 'keyboard-amp', label: 'Keyboard Amp', color: '#8b5cf6' },
    ],
  },
];

function normalizeEmojiIcon(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return [...trimmed].slice(0, 2).join('');
}

function normalizeRotation(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped;
}

interface LegendItemRowProps {
  item: StageplotItem;
  index: number;
  canEdit: boolean;
  selected: boolean;
  /** Other items on the same list (inputs or outputs), used to block manually
   * typing a channel number that's already claimed by a sibling. */
  siblingItems: StageplotItem[];
  onSelect: () => void;
  onCommit: (patch: Partial<Pick<StageplotItem, 'label' | 'channel' | 'description' | 'stand' | 'noChannel'>>) => void;
  onRemove: () => void;
}

// Each legend row doubles as the editor for that item's channel info, with its
// own local draft state so typing doesn't fight updates from sibling rows or
// canvas drags. Edits commit on blur/Enter, matching the rest of the editor.
function LegendItemRow({ item, index, canEdit, selected, siblingItems, onSelect, onCommit, onRemove }: LegendItemRowProps) {
  const badge = stageplotItemBadge(item, index);
  const [label, setLabel] = useState(item.label);
  const [channel, setChannel] = useState(item.channel ?? '');
  const [description, setDescription] = useState(item.description ?? '');
  const [stand, setStand] = useState(item.stand ?? '');

  useEffect(() => {
    setLabel(item.label);
    setChannel(item.channel ?? '');
    setDescription(item.description ?? '');
    setStand(item.stand ?? '');
  }, [item.id, item.label, item.channel, item.description, item.stand]);

  const commit = () => {
    const nextLabel = label.trim() || item.label;
    let nextChannel = channel.trim();
    const nextDescription = description.trim();
    const nextStand = stand.trim();

    if (nextChannel && nextChannel !== (item.channel ?? '')) {
      const claimedBy = siblingItems.find((other) => other.id !== item.id && other.channel?.trim() === nextChannel);
      if (claimedBy) {
        toast.error(`Channel ${nextChannel} is already used by "${claimedBy.label || 'another item'}".`);
        nextChannel = item.channel ?? '';
        setChannel(nextChannel);
      }
    }

    if (
      nextLabel === item.label
      && nextChannel === (item.channel ?? '')
      && nextDescription === (item.description ?? '')
      && nextStand === (item.stand ?? '')
    ) return;
    onCommit({
      label: nextLabel,
      channel: nextChannel || undefined,
      description: nextDescription || undefined,
      stand: nextStand || undefined,
    });
  };

  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
  };

  const meta = [item.description?.trim(), item.stand?.trim()].filter(Boolean).join(' · ');
  const isOutput = stageplotIsOutputKind(item.kind);
  const hasChannel = channel.trim().length > 0;
  const numberClassName = `stageplot-legend-number${hasChannel ? (isOutput ? ' stageplot-legend-number--output' : ' stageplot-legend-number--input') : ' stageplot-legend-number--index'}`;
  // Keep rows compact by default — only show the stand/description editors
  // once the row is selected or already has something in them, rather than
  // always showing two empty inputs per item.
  const showDetails = selected || stand.trim().length > 0 || description.trim().length > 0;

  return (
    <li>
      <div className={`stageplot-legend-row${selected ? ' stageplot-legend-row--selected' : ''}`} style={{ color: item.color ?? 'var(--text)' }}>
        <div className="stageplot-legend-row-main">
          {item.noChannel ? (
            <span className="stageplot-legend-number stageplot-legend-number--none" title="Doesn't need its own channel">–</span>
          ) : canEdit ? (
            <input
              type="text"
              inputMode="numeric"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              onBlur={commit}
              onKeyDown={blurOnEnter}
              placeholder={`#${index + 1}`}
              aria-label="Channel number"
              className={numberClassName}
            />
          ) : (
            <span className={numberClassName}>{badge.value}</span>
          )}
          {canEdit ? (
            <button
              type="button"
              className={`stageplot-channel-switch${item.noChannel ? '' : ' stageplot-channel-switch--active'}`}
              role="switch"
              aria-checked={!item.noChannel}
              onClick={() => onCommit({ noChannel: !item.noChannel })}
              title={item.noChannel ? "Doesn't need its own channel (e.g. a player position — the amp gets the channel)" : 'Needs its own channel'}
            >
              <span className="stageplot-channel-switch-track">Channel</span>
            </button>
          ) : null}
          <button
            type="button"
            className="stageplot-legend-select"
            onClick={onSelect}
            title="Select on stage"
            aria-label={`Select ${item.label || 'item'} on stage`}
          >
            <img
              src={stageplotIconForKind(item.kind)}
              alt=""
              aria-hidden="true"
              className="stageplot-instrument-icon stageplot-instrument-icon--legend"
            />
          </button>
          {canEdit ? (
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onBlur={commit}
              onKeyDown={blurOnEnter}
              placeholder="Label"
              aria-label="Item label"
              className="stageplot-legend-input stageplot-legend-input--label"
            />
          ) : (
            <span className="stageplot-legend-label">{item.label || 'Untitled item'}</span>
          )}
          {canEdit ? (
            <button type="button" className="stageplot-legend-remove" onClick={onRemove} title="Remove item" aria-label="Remove item">
              <Trash2 size={12} />
            </button>
          ) : null}
        </div>
        {canEdit && showDetails ? (
          <input
            type="text"
            value={stand}
            onChange={(event) => setStand(event.target.value)}
            onBlur={commit}
            onKeyDown={blurOnEnter}
            placeholder="Stand (e.g. short boom)"
            aria-label="Item stand"
            className="stageplot-legend-input stageplot-legend-input--stand"
          />
        ) : null}
        {canEdit && showDetails ? (
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={commit}
            onKeyDown={blurOnEnter}
            placeholder="Description (e.g. mic model)"
            aria-label="Item description"
            className="stageplot-legend-input stageplot-legend-input--description"
          />
        ) : null}
        {canEdit && !showDetails ? (
          <button type="button" className="stageplot-legend-add-details" onClick={onSelect}>
            + Stand / description
          </button>
        ) : null}
        {!canEdit && meta ? <span className="stageplot-legend-meta">{meta}</span> : null}
      </div>
    </li>
  );
}

export default function StageplotEditor({
  stageplot,
  canEdit,
  showHeader = true,
  toolbarPortalTarget = null,
  onRename,
  onUpdateIcon,
  onDelete,
  onSaveContent,
  onCopyPublicLink,
}: StageplotEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<StageplotItem[]>(stageplot.items);
  const [drawingLayers, setDrawingLayers] = useState<SongHandNoteDocument[]>(stageplot.drawingLayers ?? []);
  const [renameValue, setRenameValue] = useState(stageplot.name);
  const [renaming, setRenaming] = useState(false);
  const [iconDraft, setIconDraft] = useState(stageplot.icon ?? '🎤');
  const [showIconEditor, setShowIconEditor] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const saveStateResetTimerRef = useRef<number | null>(null);
  const iconPickerRef = useRef<HTMLDivElement | null>(null);
  const iconTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setItems(stageplot.items);
    setDrawingLayers(stageplot.drawingLayers ?? []);
    setRenameValue(stageplot.name);
    setIconDraft(stageplot.icon ?? '🎤');
  }, [stageplot]);

  useEffect(() => {
    return () => {
      if (saveStateResetTimerRef.current !== null) {
        window.clearTimeout(saveStateResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showIconEditor) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (iconPickerRef.current?.contains(target)) return;
      if (iconTriggerRef.current?.contains(target)) return;
      setShowIconEditor(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowIconEditor(false);
      iconTriggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showIconEditor]);

  // Split for the legend: most items feed a numbered input channel, but a
  // few (monitors, PA, subs, IEM) are outputs from the desk and belong on
  // their own list rather than mixed in with input channel numbers. Items
  // toggled to "no channel" (e.g. a player position) move out of both
  // numbered lists into their own reference list.
  const inputListItems = useMemo(
    () => items.map((item, index) => ({ item, index }))
      .filter(({ item }) => !stageplotIsOutputKind(item.kind) && !item.noChannel)
      .sort(compareStageplotItemsByChannel),
    [items]
  );
  const outputListItems = useMemo(
    () => items.map((item, index) => ({ item, index }))
      .filter(({ item }) => stageplotIsOutputKind(item.kind) && !item.noChannel)
      .sort(compareStageplotItemsByChannel),
    [items]
  );
  const referenceListItems = useMemo(
    () => items.map((item, index) => ({ item, index })).filter(({ item }) => item.noChannel),
    [items]
  );

  const persistContent = useCallback(async (nextItems: StageplotItem[], nextLayers: SongHandNoteDocument[]) => {
    setSaveState('saving');
    try {
      await onSaveContent(nextItems, nextLayers);
      setSaveState('saved');
      if (saveStateResetTimerRef.current !== null) {
        window.clearTimeout(saveStateResetTimerRef.current);
      }
      saveStateResetTimerRef.current = window.setTimeout(() => {
        setSaveState((current) => (current === 'saved' ? 'idle' : current));
      }, 1800);
    } catch {
      setSaveState('error');
    }
  }, [onSaveContent]);

  // Lowest channel number not already claimed by another item on the same
  // list, so new items (or items switched back to needing a channel) get
  // patched in numerically rather than left blank for the user to fill in
  // by hand. Inputs and outputs (monitors/PA/subs/IEM) are numbered as two
  // separate sequences, matching how a real input list vs. monitor list works.
  // Items currently marked "no channel" don't count as occupying their old
  // number — that number is free for anyone else to claim while it's unused.
  const nextAvailableChannel = (currentItems: StageplotItem[], isOutput: boolean, excludeItemId?: string): string => {
    const usedChannels = new Set(
      currentItems
        .filter((item) => item.id !== excludeItemId && !item.noChannel && stageplotIsOutputKind(item.kind) === isOutput)
        .map((item) => Number(item.channel?.trim()))
        .filter((value) => Number.isFinite(value))
    );
    let candidate = 1;
    while (usedChannels.has(candidate)) candidate += 1;
    return String(candidate);
  };

  const makeItem = (template: { kind: string; label: string; color: string }, x: number, y: number): StageplotItem => ({
    id: generateId(),
    kind: template.kind,
    label: template.label,
    color: template.color,
    x,
    y,
    rotation: 0,
    channel: nextAvailableChannel(items, stageplotIsOutputKind(template.kind)),
  });

  const addItemAtPosition = (template: { kind: string; label: string; color: string }, x: number, y: number) => {
    const item = makeItem(template, x, y);
    const nextItems = [...items, item];
    setItems(nextItems);
    void persistContent(nextItems, drawingLayers);
  };

  const handlePaletteDragStart = (event: React.DragEvent<HTMLButtonElement>, template: { kind: string; label: string; color: string }) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(ITEM_DRAG_MIME, JSON.stringify(template));
    event.dataTransfer.setData('text/plain', template.label);
  };

  const handlePaletteAddClick = (template: { kind: string; label: string; color: string }) => {
    if (!canEdit) return;
    // Stagger successive click-added items around the center instead of
    // dropping every one on the exact same spot, so they don't perfectly
    // overlap and need to be dragged apart by hand.
    const offset = CLICK_ADD_OFFSETS[items.length % CLICK_ADD_OFFSETS.length];
    addItemAtPosition(template, clamp01(0.5 + offset.dx), clamp01(0.5 + offset.dy));
  };

  const handleStageDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const raw = event.dataTransfer.getData(ITEM_DRAG_MIME);
    if (!raw) return;

    event.preventDefault();

    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    try {
      const template = JSON.parse(raw) as { kind?: unknown; label?: unknown; color?: unknown };
      if (typeof template.kind !== 'string' || typeof template.label !== 'string') return;
      addItemAtPosition(
        {
          kind: template.kind,
          label: template.label,
          color: typeof template.color === 'string' ? template.color : '#6b7280',
        },
        clamp01((event.clientX - rect.left) / rect.width),
        clamp01((event.clientY - rect.top) / rect.height)
      );
    } catch {
      // Ignore malformed drag payloads.
    }
  };

  const moveItem = (itemId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canEdit) return;

    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);

    let latestItems = items;

    const move = (moveEvent: PointerEvent) => {
      setItems((prev) => {
        const next = prev.map((item) => (
        item.id === itemId
          ? {
              ...item,
              x: clamp01((moveEvent.clientX - rect.left) / rect.width),
              y: clamp01((moveEvent.clientY - rect.top) / rect.height),
            }
          : item
        ));
        latestItems = next;
        return next;
      });
    };

    const release = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', release);
      target.removeEventListener('pointercancel', release);
      void persistContent(latestItems, drawingLayers);
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', release, { once: true });
    target.addEventListener('pointercancel', release, { once: true });
  };

  const updateItemFields = (itemId: string, patch: Partial<Pick<StageplotItem, 'label' | 'channel' | 'description' | 'stand' | 'noChannel'>>) => {
    if (!canEdit) return;
    const current = items.find((item) => item.id === itemId);
    const nextPatch = { ...patch };
    if (typeof patch.noChannel === 'boolean' && current) {
      const isOutput = stageplotIsOutputKind(current.kind);
      if (patch.noChannel === true) {
        // An item with no channel yet shows a position-based fallback number
        // (e.g. "#3") that isn't actually stored — freeze a real one so
        // there's something concrete to try to reclaim if it's switched back
        // on before anyone else claims the number.
        if (!current.channel?.trim()) {
          nextPatch.channel = nextAvailableChannel(items, isOutput, itemId);
        }
      } else {
        // Switching back on: reclaim the remembered number if it's still
        // free, otherwise (another item claimed it while this one was
        // channel-less) fall back to the next available number instead.
        const remembered = current.channel?.trim();
        const stillFree = remembered && !items.some((item) => (
          item.id !== itemId && !item.noChannel && stageplotIsOutputKind(item.kind) === isOutput && item.channel?.trim() === remembered
        ));
        if (!stillFree) {
          nextPatch.channel = nextAvailableChannel(items, isOutput, itemId);
        }
      }
    }
    const nextItems = items.map((item) => (item.id === itemId ? { ...item, ...nextPatch } : item));
    setItems(nextItems);
    void persistContent(nextItems, drawingLayers);
  };

  const removeItem = (itemId: string) => {
    if (!canEdit) return;
    setItems((prev) => {
      const nextItems = prev.filter((item) => item.id !== itemId);
      void persistContent(nextItems, drawingLayers);
      return nextItems;
    });
    setSelectedItemId((current) => (current === itemId ? null : current));
  };

  const rotateItemWithHandle = (itemId: string, event: React.PointerEvent<HTMLSpanElement>) => {
    if (!canEdit) return;

    const stage = stageRef.current;
    if (!stage) return;

    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);

    const rect = stage.getBoundingClientRect();
    const targetItem = items.find((item) => item.id === itemId);
    if (!targetItem) return;

    const centerX = rect.left + (targetItem.x * rect.width);
    const centerY = rect.top + (targetItem.y * rect.height);
    const startRotation = normalizeRotation(targetItem.rotation);
    const startPointerAngle = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
    const angleOffset = startPointerAngle - startRotation;

    let latestItems = items;

    const move = (moveEvent: PointerEvent) => {
      const pointerAngle = (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180) / Math.PI;
      const nextRotation = normalizeRotation(pointerAngle - angleOffset);

      setItems((prev) => {
        const next = prev.map((item) => (
          item.id === itemId
            ? {
                ...item,
                rotation: nextRotation,
              }
            : item
        ));
        latestItems = next;
        return next;
      });
    };

    const release = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', release);
      target.removeEventListener('pointercancel', release);
      void persistContent(latestItems, drawingLayers);
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', release, { once: true });
    target.addEventListener('pointercancel', release, { once: true });
  };

  const resizeItemWithHandle = (itemId: string, event: React.PointerEvent<HTMLSpanElement>) => {
    if (!canEdit) return;

    const stage = stageRef.current;
    if (!stage) return;

    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);

    const rect = stage.getBoundingClientRect();
    const targetItem = items.find((item) => item.id === itemId);
    if (!targetItem) return;

    const centerX = rect.left + (targetItem.x * rect.width);
    const centerY = rect.top + (targetItem.y * rect.height);
    // Distance from the item's center to the pointer at drag start, so
    // subsequent movement scales relative to where the handle was grabbed
    // rather than jumping to an absolute size.
    const startDistance = Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY));
    const startScale = typeof targetItem.scale === 'number' && Number.isFinite(targetItem.scale) ? targetItem.scale : 1;

    let latestItems = items;

    const move = (moveEvent: PointerEvent) => {
      const distance = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY);
      const nextScale = Math.min(
        STAGEPLOT_ITEM_SCALE_MAX,
        Math.max(STAGEPLOT_ITEM_SCALE_MIN, startScale * (distance / startDistance))
      );

      setItems((prev) => {
        const next = prev.map((item) => (
          item.id === itemId
            ? {
                ...item,
                scale: nextScale,
              }
            : item
        ));
        latestItems = next;
        return next;
      });
    };

    const release = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', release);
      target.removeEventListener('pointercancel', release);
      void persistContent(latestItems, drawingLayers);
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', release, { once: true });
    target.addEventListener('pointercancel', release, { once: true });
  };

  useEffect(() => {
    if (!canEdit || !selectedItemId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      event.preventDefault();
      const nextItems = items.filter((item) => item.id !== selectedItemId);
      setItems(nextItems);
      setSelectedItemId(null);
      void persistContent(nextItems, drawingLayers);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit, selectedItemId, items, drawingLayers, persistContent]);

  const handleRenameCommit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== stageplot.name) {
      onRename(trimmed);
    }
    setRenameValue(stageplot.name);
    setRenaming(false);
  };

  const handleDeleteStageplot = async () => {
    const confirmed = await showConfirmToast(`Move stageplot "${stageplot.name}" to trash?`, {
      confirmLabel: 'Move to trash',
    });
    if (!confirmed) return;
    await onDelete();
  };

  const summaryLabel = `${items.length} item${items.length === 1 ? '' : 's'}`;

  const saveStatusLabel = saveState === 'saving'
    ? 'Autosaving…'
    : saveState === 'saved'
      ? 'All changes saved'
      : saveState === 'error'
        ? 'Autosave failed'
        : 'Autosave on';

  const saveStatusClassName = saveState === 'saving'
    ? 'notes-save-status notes-save-status--saving'
    : saveState === 'saved'
      ? 'notes-save-status notes-save-status--saved'
      : saveState === 'error'
        ? 'notes-save-status notes-save-status--error'
        : 'notes-save-status notes-save-status--idle';

  const toolbarPanel = canEdit ? (
    <>
      <div className="stageplot-palette">
        {PALETTE_CATEGORIES.map((category) => (
          <div key={category.name} className="stageplot-palette-category">
            <div className="stageplot-palette-category-name">{category.name}</div>
            <div className="stageplot-palette-category-items">
              {category.items.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className="stageplot-palette-btn"
                  draggable
                  onDragStart={(event) => handlePaletteDragStart(event, entry)}
                  onClick={() => handlePaletteAddClick(entry)}
                  title={`Drag ${entry.label} to stage`}
                >
                  <img
                    src={stageplotIconForKind(entry.kind)}
                    alt=""
                    aria-hidden="true"
                    className="stageplot-instrument-icon stageplot-instrument-icon--palette"
                  />
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="stageplot-palette-btn stageplot-palette-btn--custom"
          draggable
          onDragStart={(event) => handlePaletteDragStart(event, CUSTOM_ITEM_TEMPLATE)}
          onClick={() => handlePaletteAddClick(CUSTOM_ITEM_TEMPLATE)}
          title="Add a custom item"
        >
          <Plus size={14} aria-hidden="true" />
          <span>Custom</span>
        </button>
      </div>
    </>
  ) : null;

  return (
    <>
      {showHeader ? (
        <div className="list-sticky-header">
          <div className="page-section-header resource-header">
            <div className="setlist-title-block">
              {renaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleRenameCommit();
                    if (event.key === 'Escape') {
                      setRenameValue(stageplot.name);
                      setRenaming(false);
                    }
                  }}
                  onBlur={handleRenameCommit}
                  className="setlist-name-input"
                />
              ) : (
                <div className="song-list-title-row">
                  <h1 className="resource-title setlist-title resource-title--setlist" onDoubleClick={() => canEdit && setRenaming(true)}>
                    {canEdit ? (
                      <div className="icon-picker-wrapper" ref={iconPickerRef}>
                        <button
                          ref={iconTriggerRef}
                          type="button"
                          className={`icon-picker-trigger${showIconEditor ? ' is-open' : ''}`}
                          aria-haspopup="dialog"
                          aria-expanded={showIconEditor}
                          onClick={(e) => { e.stopPropagation(); setShowIconEditor((v) => !v); }}
                          title="Change stageplot icon"
                          aria-label="Change stageplot icon"
                        >
                          <span className="resource-title-icon" aria-hidden="true">{stageplot.icon ?? '🗺️'}</span>
                        </button>
                        {showIconEditor && (
                          <div className="icon-picker-popover" role="dialog" aria-label="Choose stageplot icon">
                            <div className="emoji-choice-grid" role="radiogroup" aria-label="Stageplot icon options">
                              <button
                                type="button"
                                className={`emoji-choice-btn${!stageplot.icon ? ' active' : ''}`}
                                onClick={() => { onUpdateIcon(undefined); setIconDraft('🗺️'); setShowIconEditor(false); }}
                                aria-pressed={!stageplot.icon}
                              >
                                <Map size={16} />
                              </button>
                              {TECH_RIDER_ICON_OPTIONS.map((emoji) => {
                                const selected = iconDraft === emoji;
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className={`emoji-choice-btn${selected ? ' active' : ''}`}
                                    onClick={() => { onUpdateIcon(normalizeEmojiIcon(emoji)); setIconDraft(emoji); setShowIconEditor(false); }}
                                    aria-pressed={selected}
                                  >
                                    {emoji}
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              type="button"
                              className="icon-picker-reset-btn"
                              onClick={() => { onUpdateIcon(undefined); setIconDraft('🗺️'); setShowIconEditor(false); }}
                            >
                              Reset to default
                            </button>
                          </div>
                        )}
                      </div>
                    ) : stageplot.icon ? (
                      <span className="resource-title-icon" aria-hidden="true">{stageplot.icon}</span>
                    ) : null}
                    <span>{stageplot.name}</span>
                  </h1>
                  {canEdit ? (
                    <button
                      type="button"
                      className="title-rename-btn"
                      onClick={() => setRenaming(true)}
                      title="Rename stageplot"
                      aria-label="Rename stageplot"
                    >
                      <PenLine size={14} />
                    </button>
                  ) : null}
                </div>
              )}
              <div className="autosave-status-row">
                <p className="song-list-summary setlist-song-count">{summaryLabel}</p>
                {canEdit ? (
                  <span className={saveStatusClassName} aria-live="polite">{saveStatusLabel}</span>
                ) : null}
              </div>
            </div>
            <div className="resource-header-actions">
              <button
                type="button"
                className="btn btn--accent"
                onClick={() => void onCopyPublicLink()}
                title={stageplot.publicShareEnabled ? 'Copy public link' : 'Create & copy public link'}
                aria-label={stageplot.publicShareEnabled ? 'Copy public link' : 'Create and copy public link'}
              >
                <Link2 size={14} />
              </button>
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => void handleDeleteStageplot()}
                  title={`Delete stageplot ${stageplot.name}`}
                  aria-label={`Delete stageplot ${stageplot.name}`}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          </div>



        </div>
      ) : null}

      {toolbarPortalTarget
        ? createPortal(toolbarPanel, toolbarPortalTarget)
        : toolbarPanel
          ? (
            <div className="stageplot-toolbar" role="region" aria-label="Stageplot tools">
              {toolbarPanel}
            </div>
          )
          : null}

      <div className="stageplot-content-row">
      <div
          ref={stageRef}
          className="stageplot-stage song-notes-stage"
          onDragOver={(event) => {
            if (!canEdit) return;
            if (!event.dataTransfer.types.includes(ITEM_DRAG_MIME)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleStageDrop}
        >
        <div className="stageplot-stage-grid" />
        <div className="stageplot-front-edge" aria-hidden="true" />
        <div className="stageplot-audience-marker" aria-label="Audience-facing side">
          Audience
        </div>
        {items.map((item, index) => {
          const badge = stageplotItemBadge(item, index);
          return (
          <button
            key={item.id}
            type="button"
            draggable={false}
            className={`stageplot-item${selectedItemId === item.id ? ' stageplot-item--selected' : ''}`}
            style={{
              left: `${item.x * 100}%`,
              top: `${item.y * 100}%`,
              color: item.color ?? 'var(--text)',
              ['--item-scale' as string]: stageplotItemDisplayScale(item),
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              setSelectedItemId(item.id);
              moveItem(item.id, event);
            }}
            onClick={() => setSelectedItemId(item.id)}
            title={[item.label, item.noChannel ? null : (badge.isChannel ? `Ch ${badge.value}` : `item ${badge.value}`)].filter(Boolean).join(' — ')}
          >
            <div
              className="stageplot-item-icon-wrap"
              style={{ transform: `rotate(${normalizeRotation(item.rotation)}deg)` }}
            >
              <img
                src={stageplotIconForKind(item.kind)}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="stageplot-instrument-icon stageplot-instrument-icon--item"
              />
              {canEdit && selectedItemId === item.id ? (
                <span
                  className="stageplot-rotation-handle"
                  aria-label="Rotate item"
                  title="Drag to rotate"
                  onPointerDown={(event) => rotateItemWithHandle(item.id, event)}
                >
                  <RotateCw size={13} strokeWidth={2.5} aria-hidden="true" />
                </span>
              ) : null}
            </div>
            {canEdit && selectedItemId === item.id ? (
              <span
                className="stageplot-resize-handle"
                aria-label="Resize item"
                title="Drag to resize"
                onPointerDown={(event) => resizeItemWithHandle(item.id, event)}
              >
                <Maximize2 size={13} strokeWidth={2.5} aria-hidden="true" />
              </span>
            ) : null}
            {item.noChannel ? null : (
              <span
                className={`stageplot-item-number stageplot-item-number--${stageplotItemBadgeCorner(item, items)}${badge.isChannel ? (stageplotIsOutputKind(item.kind) ? ' stageplot-item-number--output' : ' stageplot-item-number--input') : ' stageplot-item-number--index'}`}
                aria-hidden="true"
              >
                {badge.value}
              </span>
            )}
          </button>
          );
        })}
        </div>
      {(inputListItems.length > 0 || outputListItems.length > 0 || referenceListItems.length > 0) ? (
        <div className="stageplot-legend-section">
          {inputListItems.length > 0 ? (
            <div className="stageplot-legend-group">
              <div className="stageplot-legend-heading">Technical Inputs</div>
              <ol className="stageplot-legend">
                {inputListItems.map(({ item, index }) => (
                  <LegendItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    canEdit={canEdit}
                    selected={selectedItemId === item.id}
                    siblingItems={inputListItems.map(({ item: other }) => other)}
                    onSelect={() => setSelectedItemId(item.id)}
                    onCommit={(patch) => updateItemFields(item.id, patch)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </ol>
            </div>
          ) : null}
          {inputListItems.length > 0 && (outputListItems.length > 0 || referenceListItems.length > 0) ? (
            <div className="stageplot-legend-divider" aria-hidden="true" />
          ) : null}
          {outputListItems.length > 0 ? (
            <div className="stageplot-legend-group">
              <div className="stageplot-legend-heading">Monitors</div>
              <ol className="stageplot-legend">
                {outputListItems.map(({ item, index }) => (
                  <LegendItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    canEdit={canEdit}
                    selected={selectedItemId === item.id}
                    siblingItems={outputListItems.map(({ item: other }) => other)}
                    onSelect={() => setSelectedItemId(item.id)}
                    onCommit={(patch) => updateItemFields(item.id, patch)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </ol>
            </div>
          ) : null}
          {outputListItems.length > 0 && referenceListItems.length > 0 ? (
            <div className="stageplot-legend-divider" aria-hidden="true" />
          ) : null}
          {referenceListItems.length > 0 ? (
            <div className="stageplot-legend-group">
              <div className="stageplot-legend-heading">Also on stage</div>
              <ol className="stageplot-legend">
                {referenceListItems.map(({ item, index }) => (
                  <LegendItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    canEdit={canEdit}
                    selected={selectedItemId === item.id}
                    siblingItems={[]}
                    onSelect={() => setSelectedItemId(item.id)}
                    onCommit={(patch) => updateItemFields(item.id, patch)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
      </div>
    </>
  );
}
