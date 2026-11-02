import { Palette, Refresh } from 'iconoir-react';
import { useDefaultStylePack } from '../../hooks/useDefaultStylePack';
import { useT } from '../../lib/i18n';
import { openStudioSettings } from '../../lib/studioSettingsDomains';

/** Shown where styles would be listed while Studio has no style pack installed (ADR 0011). */
export function NoStylePacksNotice({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const defaultPack = useDefaultStylePack(true);
  const installing = defaultPack?.state === 'installing';
  const installed = defaultPack?.state === 'installed';
  const message = installing
    ? t('stylePacks.notice.installing')
    : installed
      ? t('stylePacks.notice.installed')
      : t('stylePacks.notice.empty');
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] ${compact ? 'p-2.5' : 'p-4'}`}
    >
      <Palette
        width={compact ? 16 : 20}
        height={compact ? 16 : 20}
        aria-hidden="true"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <strong className="block text-sm">
          {installing
            ? t('stylePacks.notice.titleInstalling')
            : installed
              ? t('stylePacks.notice.titleInstalled')
              : t('stylePacks.notice.title')}
        </strong>
        <p className="text-xs text-balance text-[color:var(--wb-muted)]">{message}</p>
      </div>
      {installing ? null : (
        <button
          type="button"
          onClick={() => (installed ? window.location.reload() : openStudioSettings('extensions'))}
          className="studio-primary-control px-3"
        >
          {installed ? <Refresh width={14} height={14} aria-hidden="true" /> : null}
          {installed ? t('onboarding.stylePacks.reload') : t('onboarding.stylePacks.get')}
        </button>
      )}
    </div>
  );
}
