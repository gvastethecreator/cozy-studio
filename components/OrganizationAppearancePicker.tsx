import React from 'react';

const COLORS = [
  '#e879a0',
  '#f59e0b',
  '#eab308',
  '#4ade80',
  '#2dd4bf',
  '#38bdf8',
  '#818cf8',
  '#c084fc',
  '#fb7185',
  '#94a3b8',
];
const EMOJIS = [
  '📁',
  '⭐',
  '❤️',
  '🎨',
  '🧑',
  '🦊',
  '🌿',
  '🌈',
  '🔥',
  '✨',
  '🎮',
  '👾',
  '🏰',
  '🏙️',
  '🚀',
  '📷',
  '🎬',
  '💡',
  '💎',
  '🛠️',
  '📦',
  '✅',
  '🎯',
  '🌙',
];

export function TagColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="organization-color-picker" aria-label="Tag color">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Color ${color}`}
          aria-pressed={value === color}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        />
      ))}
      <label className="organization-custom-color" title="Custom color">
        <span className="sr-only">Custom tag color</span>
        <input
          type="color"
          aria-label="Custom tag color"
          value={value ?? '#818cf8'}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button type="button" aria-label="Clear tag color" onClick={() => onChange(null)}>
        ×
      </button>
    </div>
  );
}

export function CollectionEmojiPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="organization-emoji-picker">
      <div role="group" aria-label="Collection emoji">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Emoji ${emoji}`}
            aria-pressed={value === emoji}
            onClick={() => onChange(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        Custom emoji
        <input
          className="studio-well min-w-0 flex-1"
          aria-label="Custom collection emoji"
          value={value ?? ''}
          maxLength={32}
          onChange={(event) => onChange(event.target.value || null)}
        />
      </label>
    </div>
  );
}
