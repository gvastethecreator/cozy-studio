import React from 'react';
import { useInstalledStylePacksVersion } from '../../hooks/useInstalledStylePacksSync';
import { LazySurfaceFallback } from '../ui/LazySurfaceFallback';
import type { StylesBrowserProps } from './StylesBrowser';

export type StylesRecipeProps = StylesBrowserProps;

const StylesBrowser = React.lazy(() =>
  import('./StylesBrowser').then((module) => ({
    default: module.StylesBrowser,
  })),
);

export const StylesRecipe: React.FC<StylesRecipeProps> = (props) => {
  // A new pack list remounts the browser so every view reads it again.
  const packListVersion = useInstalledStylePacksVersion();
  return (
    <React.Suspense fallback={<LazySurfaceFallback label="Loading styles" />}>
      <StylesBrowser key={packListVersion} {...props} />
    </React.Suspense>
  );
};
