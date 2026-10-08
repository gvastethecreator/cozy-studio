import { useState } from 'react';
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import type { ImageGridSortOption } from '../lib/imageGridPresentation';

export const libraryQueryParsers = {
  workspace: parseAsString,
  q: parseAsString.withDefault(''),
  favorites: parseAsBoolean.withDefault(false),
  sort: parseAsStringLiteral([
    'desc',
    'asc',
    'prompt',
    'prompt_desc',
    'ratio',
    'id',
  ] as const).withDefault('desc'),
};

export interface LibraryFilters {
  q: string;
  favorites: boolean;
  sort: ImageGridSortOption;
}

export function useLibraryUrlState() {
  // Capture intent before hydration writes the effective workspace into a plain startup URL.
  const [hasInitialLibraryLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return Object.keys(libraryQueryParsers).some((key) => params.has(key));
  });
  const [query, setQuery] = useQueryStates(libraryQueryParsers, {
    history: 'replace',
    clearOnDefault: true,
  });
  return { query, setQuery, hasInitialLibraryLink };
}
