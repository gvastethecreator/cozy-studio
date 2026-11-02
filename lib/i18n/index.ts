// UI language. en.ts is the source dictionary; es.ts must have every key (typecheck fails if not).
// main.tsx sets the saved language before mount, and Settings sets it again after a save.
// Never route model prompts, style pack content, preset names or user data through t().
import { useSyncExternalStore } from 'react';
import type { StudioLanguage } from '../../packages/shared/src/studioSettings';
import { en, type Dictionary, type MessageKey } from './en';
import { es } from './es';

const DICTIONARIES: Record<StudioLanguage, Dictionary> = { en, es };

let activeLanguage: StudioLanguage = 'en';
const listeners = new Set<() => void>();

export function getLanguage(): StudioLanguage {
  return activeLanguage;
}

/** Anything but a known language (an older backend sends none) falls back to English. */
export function setLanguage(language: StudioLanguage | undefined) {
  const next = language === 'es' ? 'es' : 'en';
  if (next === activeLanguage) return;
  activeLanguage = next;
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

type Params = Record<string, string | number>;

function interpolate(template: string, params: Params | undefined) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? formatParam(params[name]) : match,
  );
}

function formatParam(value: string | number) {
  return typeof value === 'number' ? formatNumber(value) : value;
}

/** Plural entries pick a form from `params.count` with the language's plural rules. */
export function t(key: MessageKey, params?: Params): string {
  const entry = DICTIONARIES[activeLanguage][key];
  if (typeof entry === 'string') return interpolate(entry, params);
  const count = Number(params?.count ?? 0);
  const form = new Intl.PluralRules(activeLanguage).select(count) as keyof typeof entry;
  return interpolate(entry[form] ?? entry.other, params);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(activeLanguage, options).format(value);
}

/** Date and time, or only the parts named in `options`. */
export function formatDateTime(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Date(value).toLocaleString(activeLanguage, options);
}

export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleDateString(activeLanguage, options);
}

export function formatTime(value: string | number | Date, options?: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleTimeString(activeLanguage, options);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Binary multiples with the common KB/MB labels. Whole bytes below 1 KB, one decimal above. */
export function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatNumber(value, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${BYTE_UNITS[unit]}`;
}

const I18N = { t, formatNumber, formatDateTime, formatDate, formatTime, formatBytes };

/** Re-renders the caller when the language changes. */
export function useT() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { ...I18N, language };
}
