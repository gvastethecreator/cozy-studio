import {
  isRecord,
  normalizeImageHashtag,
  validateCatalogCollectionName,
  type CatalogCollection,
  type CatalogOrganizeSuggestion,
} from '../../../packages/shared/src';
import { queryCatalogDetails, type CatalogImage } from './catalog';
import { listCatalogCollections } from './catalogCollections';
import { listCatalogTags } from './catalogTags';

// ponytail: fixed stopword list; tune from real prompts.
const STOPWORDS = new Set(
  'the and for with from that this into image create make style render illustration detailed high quality ultra una uno unos unas los las del con para por como desde este esta esto que sin imagen crear estilo'.split(
    ' ',
  ),
);
type SuggestionImage = Pick<
  CatalogImage,
  'id' | 'prompt' | 'recipeId' | 'generationConfig' | 'thumbnailUrl'
>;
type Token = { key: string; name: string; kind: 'style' | 'recipe' | 'word' };
const priority = { style: 0, recipe: 1, word: 2 };
const fold = (value: string) => value.normalize('NFC').toLowerCase();

/** Greedy, disjoint groups: metadata is read locally and never sent to a provider. */
export function groupUnorganizedImages(
  images: readonly SuggestionImage[],
  {
    tagNames,
    collections,
  }: {
    tagNames: readonly string[];
    collections: readonly Pick<CatalogCollection, 'name' | 'kind'>[];
  },
): CatalogOrganizeSuggestion {
  const knownTags = new Map(tagNames.map((name) => [fold(name), name]));
  const knownCollections = new Map(
    collections.map((collection) => [fold(collection.name), collection]),
  );
  const tokens = new Map<string, Token>();
  const members = images.map((image) => {
    const keys = new Set<string>();
    const add = (kind: Token['kind'], value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      let name: string;
      try {
        name = validateCatalogCollectionName(value);
      } catch {
        return;
      }
      const key = `${kind}:${fold(name)}`;
      if (!tokens.has(key)) tokens.set(key, { key, name, kind });
      keys.add(key);
    };
    const params = image.generationConfig?.recipeParams;
    if (isRecord(params)) {
      if (Array.isArray(params.selectedStyles)) {
        for (const style of params.selectedStyles) {
          if (isRecord(style) && style.enabled !== false) add('style', style.presetName);
        }
      } else {
        add('style', params.presetName);
      }
    }
    // Imports without a prompt or style do not have enough context for a proposal.
    if (!image.prompt?.trim() && !keys.size) return keys;
    if (image.recipeId && !['default', 'styles'].includes(image.recipeId))
      add('recipe', image.recipeId);
    for (const word of fold(image.prompt ?? '').split(/[^\p{L}\p{N}]+/u)) {
      if (word.length >= 3 && !STOPWORDS.has(word)) add('word', word);
    }
    return keys;
  });
  const frequency = new Map<string, number>();
  for (const keys of members) {
    for (const key of keys) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  const remaining = new Set(images.map((_, index) => index));
  const groups: CatalogOrganizeSuggestion['groups'] = [];
  while (groups.length < 8) {
    const candidates = new Map<string, number[]>();
    for (const index of remaining) {
      for (const key of members[index]) {
        const indices = candidates.get(key);
        if (indices) indices.push(index);
        else candidates.set(key, [index]);
      }
    }
    let best: { token: Token; indices: number[]; name: string } | undefined;
    for (const token of tokens.values()) {
      if (token.kind === 'word' && (frequency.get(token.key) ?? 0) > images.length * 0.8) continue;
      const existing = knownCollections.get(fold(token.name));
      if (existing?.kind === 'smart') continue;
      const indices = candidates.get(token.key);
      if (!indices || indices.length < 2) continue;
      if (
        best &&
        (indices.length < best.indices.length ||
          (indices.length === best.indices.length &&
            priority[token.kind] >= priority[best.token.kind]))
      )
        continue;
      best = {
        token,
        indices,
        name:
          existing?.name ??
          (token.kind === 'word' ? token.name[0].toUpperCase() + token.name.slice(1) : token.name),
      };
    }
    if (!best) break;
    const { token, indices, name } = best;
    const wordCounts = new Map<string, number>();
    for (const index of indices) {
      for (const key of members[index]) {
        if (key.startsWith('word:')) wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
      }
    }
    const words = [...tokens.values()]
      .filter((item) => item.kind === 'word' && item.key !== token.key)
      .map((item) => ({ ...item, count: wordCounts.get(item.key) ?? 0 }))
      .filter((item) => item.count >= indices.length * 0.6)
      .sort((a, b) => b.count - a.count);
    const tags = new Set<string>();
    for (const value of [token.name, ...words.slice(0, 2).map((word) => word.name)]) {
      try {
        const tag = normalizeImageHashtag(
          value.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, ''),
        );
        tags.add(knownTags.get(fold(value)) ?? knownTags.get(fold(tag)) ?? tag);
      } catch {
        continue;
      }
      if (tags.size === 3) break;
    }
    groups.push({
      reason: `${{ style: 'Style', recipe: 'Workflow', word: 'Prompt' }[token.kind]}: ${token.name}`,
      collection: name,
      tags: [...tags],
      imageIds: indices.map((index) => images[index].id),
      previewUrls: indices
        .slice(0, 4)
        .flatMap((index) => (images[index].thumbnailUrl ? [images[index].thumbnailUrl!] : [])),
    });
    for (const index of indices) remaining.delete(index);
  }
  return { total: images.length, scanned: images.length, ungrouped: remaining.size, groups };
}

export function suggestCatalogOrganization(workspaceId: string): CatalogOrganizeSuggestion {
  const images: CatalogImage[] = [];
  let total = 0;
  // ponytail: newest 1000 unorganized images; page further if users have more.
  while (images.length < 1000) {
    const page = queryCatalogDetails({
      workspaceId,
      unorganized: true,
      sort: 'desc',
      limit: 200,
      offset: images.length,
    });
    total = page.total;
    images.push(...page.images);
    if (!page.hasMore || !page.images.length) break;
  }
  const suggestion = groupUnorganizedImages(images, {
    tagNames: listCatalogTags(workspaceId).map((tag) => tag.name),
    collections: listCatalogCollections(workspaceId),
  });
  return { ...suggestion, total, ungrouped: total - images.length + suggestion.ungrouped };
}
