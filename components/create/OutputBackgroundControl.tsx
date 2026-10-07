import { NavArrowDown } from 'iconoir-react';
import { resolveProviderSupportsTransparentBackground } from '../../lib/composerProviderProjection';
import { resolveGenerationBackground } from '../../lib/generationBackground';
import type { ImageGenerationConfig } from '../../types';

export function OutputBackgroundControl({
  config,
  providerId,
  onChange,
}: {
  config: ImageGenerationConfig;
  providerId?: string;
  transport?: string;
  onChange: (value: 'workflow' | 'transparent') => void;
}) {
  const supported = resolveProviderSupportsTransparentBackground(providerId);
  const removing = supported && resolveGenerationBackground(config) === 'transparent';
  return (
    <label className="create-field output-background-control relative">
      <select
        aria-label="Output background"
        className="studio-input"
        style={{ paddingRight: 32, appearance: 'none' }}
        value={removing ? 'transparent' : 'workflow'}
        onChange={(event) => onChange(event.target.value as 'workflow' | 'transparent')}
      >
        <option value="workflow">Maintain background</option>
        <option value="transparent" disabled={!supported}>
          Remove background
        </option>
      </select>
      <NavArrowDown
        width={14}
        height={14}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
      />
    </label>
  );
}
