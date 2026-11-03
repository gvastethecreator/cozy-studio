import React from 'react';
import { useT } from '../lib/i18n';

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
  const { t } = useT();
  return (
    <div className="organization-color-picker" aria-label={t('library.picker.tagColor')}>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={t('library.picker.color', { color })}
          aria-pressed={value === color}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
        />
      ))}
      <label className="organization-custom-color" title={t('library.picker.customColor')}>
        <span className="sr-only">{t('library.picker.customTagColor')}</span>
        <input
          type="color"
          aria-label={t('library.picker.customTagColor')}
          value={value ?? '#818cf8'}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        aria-label={t('library.picker.clearTagColor')}
        onClick={() => onChange(null)}
      >
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
  const { t } = useT();
  return (
    <div className="organization-emoji-picker">
      <div role="group" aria-label={t('library.picker.collectionEmoji')}>
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={t('library.picker.emoji', { emoji })}
            aria-pressed={value === emoji}
            onClick={() => onChange(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        {t('library.picker.customEmoji')}
        <input
          className="studio-well min-w-0 flex-1"
          aria-label={t('library.picker.customCollectionEmoji')}
          value={value ?? ''}
          maxLength={32}
          onChange={(event) => onChange(event.target.value || null)}
        />
      </label>
    </div>
  );
}
