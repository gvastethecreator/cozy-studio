import type { MessageKey } from './i18n/en';

export const STUDIO_SETTINGS_DOMAIN_TABS = [
  { id: 'general', labelKey: 'settings.nav.general' },
  { id: 'appearance', labelKey: 'settings.nav.appearance' },
  { id: 'providers', labelKey: 'settings.nav.providers' },
  { id: 'output', labelKey: 'settings.nav.output' },
  { id: 'library', labelKey: 'settings.nav.library' },
  { id: 'organization', labelKey: 'settings.nav.organization' },
  { id: 'extensions', labelKey: 'settings.nav.extensions' },
  { id: 'maintenance', labelKey: 'settings.nav.maintenance' },
  { id: 'help', labelKey: 'settings.nav.help' },
] as const satisfies readonly { id: string; labelKey: MessageKey }[];

export type StudioSettingsDomainId = (typeof STUDIO_SETTINGS_DOMAIN_TABS)[number]['id'];

let requestedDomain: StudioSettingsDomainId | null = null;

/** Asks Studio Settings to show this domain the next time it opens. */
export function requestStudioSettingsDomain(domain: StudioSettingsDomainId) {
  requestedDomain = domain;
}

/** Returns the requested domain once, then forgets it. */
export function takeRequestedStudioSettingsDomain() {
  const domain = requestedDomain;
  requestedDomain = null;
  return domain;
}

/** Window event that opens Studio Settings from surfaces far from the settings state. */
export const STUDIO_OPEN_SETTINGS_EVENT = 'studio:open-settings';

export function openStudioSettings(domain?: StudioSettingsDomainId) {
  if (domain) requestStudioSettingsDomain(domain);
  window.dispatchEvent(new Event(STUDIO_OPEN_SETTINGS_EVENT));
}
