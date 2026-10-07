export const STUDIO_SETTINGS_DOMAIN_TABS = [
  { id: 'general', label: 'Creation & startup' },
  { id: 'appearance', label: 'Appearance & layout' },
  { id: 'providers', label: 'Accounts & models' },
  { id: 'output', label: 'Files & naming' },
  { id: 'library', label: 'Library & imports' },
  { id: 'extensions', label: 'Styles & workflows' },
  { id: 'maintenance', label: 'Advanced & maintenance' },
  { id: 'help', label: 'Help & updates' },
] as const;

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
