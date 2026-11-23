/** What a style search reads from one preset, from the strongest evidence to the weakest. */
export interface StyleSearchFields {
  /** Id, display name and source name. */
  names: readonly (string | null | undefined)[];
  /** Style anchors, category, pack, domain and tags. */
  tags: readonly (string | null | undefined)[];
  /** Visual DNA. */
  text: readonly (string | null | undefined)[];
}

type FieldKey = keyof StyleSearchFields;

// A whole word in a weaker field still beats a substring in the name: "lace" finds
// "Chantilly Lace" and lace in a DNA field before "Tim Wallace".
const WHOLE_WORD_SCORE: Record<FieldKey, number> = { names: 6, tags: 5, text: 4 };
const SUBSTRING_SCORE: Record<FieldKey, number> = { names: 3, tags: 2, text: 1 };
const FIELD_KEYS: FieldKey[] = ['names', 'tags', 'text'];

/** Lowercase, without accents, so "pokemon" finds "Pokémon". */
export function normalizeStyleSearch(value: string) {
  const lower = value.toLowerCase();
  // Only accented Latin letters need NFD; DNA text is full of dashes and curly quotes.
  return /[À-ɏḀ-ỿ]/.test(lower) ? lower.normalize('NFD').replace(/[̀-ͯ]/g, '') : lower;
}

export function styleSearchTerms(query: string) {
  return normalizeStyleSearch(query).split(/\s+/).filter(Boolean);
}

interface SearchText {
  fields: string[];
  all: string;
}

// Each keystroke ranks the same preset objects again, and normalizing thousands of DNA texts
// costs more than the search itself. Entries live as long as the item and the fieldsOf function.
const searchTextCache = new WeakMap<object, WeakMap<object, SearchText>>();

function searchText<T>(item: T, fieldsOf: (item: T) => StyleSearchFields): SearchText {
  const cacheable = typeof item === 'object' && item !== null;
  let byItem = searchTextCache.get(fieldsOf);
  if (!byItem) {
    byItem = new WeakMap();
    searchTextCache.set(fieldsOf, byItem);
  }
  const cached = cacheable ? byItem.get(item) : undefined;
  if (cached) return cached;
  const values = fieldsOf(item);
  const fields = FIELD_KEYS.map((key) =>
    normalizeStyleSearch(values[key].filter(Boolean).join('\n')),
  );
  const text = { fields, all: fields.join('\n') };
  if (cacheable) byItem.set(item, text);
  return text;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The items that match every query term, best match first. Equal scores keep the input order.
 * An empty query returns every item in input order. fieldsOf must be pure: its result is cached
 * per item object and function, so pass the same function to reuse it across searches.
 */
export function rankStyleSearch<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => StyleSearchFields,
): T[] {
  const terms = styleSearchTerms(query).map((term) => ({
    term,
    word: new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:$|[^a-z0-9])`),
  }));
  if (terms.length === 0) return [...items];
  const ranked: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const { fields, all } = searchText(item, fieldsOf);
    if (!terms.every(({ term }) => all.includes(term))) return;
    let score = 0;
    for (const { term, word } of terms) {
      let best = 0;
      fields.forEach((text, position) => {
        if (!text.includes(term)) return;
        const key = FIELD_KEYS[position];
        best = Math.max(best, word.test(text) ? WHOLE_WORD_SCORE[key] : SUBSTRING_SCORE[key]);
      });
      if (best === 0) return;
      score += best;
    }
    ranked.push({ item, score, index });
  });
  return ranked.sort((a, b) => b.score - a.score || a.index - b.index).map(({ item }) => item);
}
