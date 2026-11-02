import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { GeneratedImageWithConfig } from '../../../types';
import {
  TCG_FINISHES,
  TCG_LAYOUTS,
  TCG_RECIPES,
  buildTcgRecipeArtPrompt,
  resolveTcgRecipe,
} from './tcgComponentModel';
import type { TcgFinish, TcgLayout, TcgRecipe } from './tcgComponentModel';
import { getRequiredTcgArtworkCount, getRequiredTcgMasks } from './tcgCardRenderer';
import type { TcgArtworkSource, TcgRenderInput } from './tcgCardRenderer';
import { getTcgCompositionReadiness, useTcgCompositionPreview } from './useTcgCompositionPreview';
import { t, useT } from '../../../lib/i18n';

export interface TcgComponentStudioProps {
  query: string;
  images: GeneratedImageWithConfig[];
  onGenerateArtwork: (artPrompt: string) => void;
  isGenerating?: boolean;
}

type ArtworkChoice =
  | { kind: 'generated'; imageId: string }
  | { kind: 'upload'; dataUrl: string; fileName: string }
  | null;

interface MaskAsset {
  dataUrl: string;
  fileName: string;
}

interface CardFields {
  name: string;
  type: string;
  rules: string;
}

const EMPTY_ARTWORK_CHOICES: ArtworkChoice[] = [null, null, null, null];
const EMPTY_CARD_FIELDS: CardFields[] = [
  { name: '', type: '', rules: '' },
  { name: '', type: '', rules: '' },
  { name: '', type: '', rules: '' },
  { name: '', type: '', rules: '' },
];

function useTcgComponentStudioController({
  query,
  images,
  onGenerateArtwork,
  isGenerating = false,
}: TcgComponentStudioProps) {
  useT();
  const initialRecipe = TCG_RECIPES[0];
  const [recipeId, setRecipeId] = useState<TcgRecipe['id']>(initialRecipe.id);
  const [finishId, setFinishId] = useState<TcgFinish['id']>(initialRecipe.finishId);
  const [layoutId, setLayoutId] = useState<TcgLayout['id']>(initialRecipe.layoutId);
  const [subjectPrompt, setSubjectPrompt] = useState('');
  const [artworkChoices, setArtworkChoices] = useState<ArtworkChoice[]>(EMPTY_ARTWORK_CHOICES);
  const [cardFields, setCardFields] = useState<CardFields[]>(EMPTY_CARD_FIELDS);
  const [maskAssets, setMaskAssets] = useState<Record<string, MaskAsset>>({});
  const [panoramaColumns, setPanoramaColumns] = useState<2 | 3>(2);
  const [activeFace, setActiveFace] = useState<0 | 1>(0);
  const [fileError, setFileError] = useState('');
  const [generationError, setGenerationError] = useState('');

  const selectedRecipe = TCG_RECIPES.find((entry) => entry.id === recipeId) ?? initialRecipe;
  const selectedFinish = TCG_FINISHES.find((entry) => entry.id === finishId) ?? TCG_FINISHES[0];
  const selectedLayout = TCG_LAYOUTS.find((entry) => entry.id === layoutId) ?? TCG_LAYOUTS[0];
  const imageById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
  const requiredArtworkCount = getRequiredTcgArtworkCount(layoutId);
  const requiredMaskKeys = getRequiredTcgMasks(finishId, layoutId);

  const artwork = useMemo<TcgArtworkSource[]>(
    () =>
      EMPTY_CARD_FIELDS.map((fields, index) => {
        const choice = artworkChoices[index];
        const src =
          choice?.kind === 'upload'
            ? choice.dataUrl
            : choice?.kind === 'generated'
              ? (imageById.get(choice.imageId)?.src ?? null)
              : null;
        return { ...fields, ...(cardFields[index] ?? fields), src };
      }),
    [artworkChoices, cardFields, imageById],
  );

  const maskSources = useMemo(
    () =>
      Object.fromEntries(Object.entries(maskAssets).map(([key, value]) => [key, value.dataUrl])),
    [maskAssets],
  );
  const renderInput = useMemo<TcgRenderInput>(
    () => ({
      layoutId,
      finishId,
      artwork,
      masks: maskSources,
      activeFace,
      panoramaColumns,
    }),
    [layoutId, finishId, artwork, maskSources, activeFace, panoramaColumns],
  );

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filterCatalog = <T extends { id: string; name: string; summary: string }>(entries: T[]) =>
    normalizedQuery
      ? entries.filter((entry) =>
          `${entry.id} ${entry.name} ${entry.summary}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : entries;
  const matchedFinishes = filterCatalog(TCG_FINISHES);
  const matchedLayouts = filterCatalog(TCG_LAYOUTS);
  const matchedRecipes = filterCatalog(TCG_RECIPES);
  const filteredCatalogCount =
    matchedFinishes.length + matchedLayouts.length + matchedRecipes.length;

  const { canvasRef, renderError, setRenderError, rendering, renderHealth } =
    useTcgCompositionPreview(renderInput);
  const { selectedArtCount, canExport, selectedReasons } = getTcgCompositionReadiness({
    artwork,
    requiredArtworkCount,
    requiredMaskKeys,
    maskSources,
    renderInput,
    renderHealth,
    rendering,
    renderError,
  });

  const setRecipe = (newRecipeId: TcgRecipe['id']) => {
    const recipe = TCG_RECIPES.find((entry) => entry.id === newRecipeId);
    if (!recipe) return;
    setRecipeId(recipe.id);
    setFinishId(recipe.finishId);
    setLayoutId(recipe.layoutId);
    setActiveFace(0);
  };

  const updateCardField = (index: number, field: keyof CardFields, value: string) => {
    setCardFields((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
  };

  const updateArtworkChoice = (index: number, choice: ArtworkChoice) => {
    setArtworkChoices((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? choice : entry)),
    );
  };

  const handleArtworkUpload = async (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setFileError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      updateArtworkChoice(index, { kind: 'upload', dataUrl, fileName: file.name });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : t('tcg.error.readImage'));
    }
  };

  const handleMaskUpload = async (key: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setFileError('');
    try {
      if (!(await hasPngSignature(file)))
        throw new Error(t('tcg.error.maskNotPng', { file: file.name }));
      const dataUrl = await readFileAsDataUrl(file);
      setMaskAssets((current) => ({ ...current, [key]: { dataUrl, fileName: file.name } }));
    } catch (error) {
      setMaskAssets((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setFileError(error instanceof Error ? error.message : t('tcg.error.readMask'));
    }
  };

  const handleGenerate = () => {
    if (!subjectPrompt.trim()) {
      setGenerationError(t('tcg.error.subjectRequired'));
      return;
    }
    setGenerationError('');
    try {
      onGenerateArtwork(buildTcgRecipeArtPrompt(recipeId, subjectPrompt.trim()));
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : t('tcg.error.startGeneration'));
    }
  };

  const exportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canExport) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setRenderError(t('tcg.error.exportPng'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const name =
        (artwork[activeFace]?.name || 'tcg-composition')
          .trim()
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '') || 'tcg-composition';
      const faceSuffix = layoutId === 'TCG-L009' ? (activeFace === 0 ? '-face-a' : '-face-b') : '';
      link.href = url;
      link.download = `${name}${faceSuffix}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  const recipeResolution = resolveTcgRecipe(recipeId);
  const getArtworkSlotLabel = (index: number) => {
    if (layoutId === 'TCG-L009') return t(index === 0 ? 'tcg.slot.faceA' : 'tcg.slot.faceB');
    if (layoutId === 'TCG-L008') return t('tcg.slot.panelOfFour', { index: index + 1 });
    if (layoutId === 'TCG-L007') return t('tcg.slot.diptychPanel', { index: index + 1 });
    if (layoutId === 'TCG-L006') return t('tcg.slot.narrative', { index: index + 1 });
    return t('tcg.slot.mainArt');
  };

  return {
    recipeId,
    setRecipe,
    selectedRecipe,
    subjectPrompt,
    setSubjectPrompt,
    generationError,
    handleGenerate,
    isGenerating,
    recipeResolution,
    setFinishId,
    setLayoutId,
    layoutId,
    setActiveFace,
    selectedLayout,
    panoramaColumns,
    setPanoramaColumns,
    activeFace,
    finishId,
    selectedFinish,
    selectedArtCount,
    requiredArtworkCount,
    artworkChoices,
    getArtworkSlotLabel,
    updateArtworkChoice,
    images,
    handleArtworkUpload,
    cardFields,
    updateCardField,
    requiredMaskKeys,
    handleMaskUpload,
    maskAssets,
    fileError,
    exportPng,
    canExport,
    selectedReasons,
    canvasRef,
    rendering,
    renderError,
    normalizedQuery,
    filteredCatalogCount,
    query,
    matchedFinishes,
    matchedLayouts,
    matchedRecipes,
  };
}

type TcgComponentStudioViewModel = ReturnType<typeof useTcgComponentStudioController>;

function TcgComponentStudioView({ model }: { model: TcgComponentStudioViewModel }) {
  const {
    recipeId,
    setRecipe,
    setFinishId,
    setLayoutId,
    layoutId,
    setActiveFace,
    finishId,
    normalizedQuery,
    filteredCatalogCount,
    query,
    matchedFinishes,
    matchedLayouts,
    matchedRecipes,
  } = model;

  return (
    <div className="space-y-5" data-tcg-component-studio>
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-[color:var(--wb-ink)]">{t('tcg.title')}</h2>
        <p className="text-xs leading-relaxed text-[color:var(--wb-muted)]">{t('tcg.intro')}</p>
      </header>

      <div className="grid min-w-0 gap-5">
        <div className="space-y-5">
          <TcgRecipePicker model={model} />

          <TcgLayoutControls model={model} />

          <TcgArtworkControls model={model} />

          <TcgMaskInputs model={model} />
        </div>

        <TcgCompositionPreview model={model} />
      </div>

      <details
        open={!!normalizedQuery}
        className="rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-4"
      >
        <summary className="cursor-pointer text-sm font-semibold text-[color:var(--wb-ink)]">
          {t('tcg.atlas.summary', {
            total: TCG_FINISHES.length + TCG_LAYOUTS.length + TCG_RECIPES.length,
            count: filteredCatalogCount,
          })}
        </summary>
        {normalizedQuery && filteredCatalogCount === 0 ? (
          <p className="mt-3 text-xs text-[color:var(--wb-muted)]">
            {t('tcg.atlas.noMatch', { query })}
          </p>
        ) : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <CatalogGroup
            title={t('tcg.atlas.finishes')}
            count={TCG_FINISHES.length}
            entries={matchedFinishes}
            selectedId={finishId}
            onSelect={(id) => setFinishId(id as TcgFinish['id'])}
          />
          <CatalogGroup
            title={t('tcg.atlas.layouts')}
            count={TCG_LAYOUTS.length}
            entries={matchedLayouts}
            selectedId={layoutId}
            onSelect={(id) => {
              setLayoutId(id as TcgLayout['id']);
              setActiveFace(0);
            }}
          />
          <CatalogGroup
            title={t('tcg.atlas.recipes')}
            count={TCG_RECIPES.length}
            entries={matchedRecipes}
            selectedId={recipeId}
            onSelect={(id) => setRecipe(id as TcgRecipe['id'])}
          />
        </div>
      </details>
    </div>
  );
}

export const TcgComponentStudio: React.FC<TcgComponentStudioProps> = (props) => {
  const view = useTcgComponentStudioController(props);
  return <TcgComponentStudioView model={view} />;
};

interface CatalogGroupProps {
  title: string;
  count: number;
  entries: Array<{ id: string; name: string; summary: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

function CatalogGroup({ title, count, entries, selectedId, onSelect }: CatalogGroupProps) {
  const { t } = useT();
  return (
    <section aria-label={t('tcg.atlas.groupLabel', { title, count })} className="space-y-2">
      <h4 className="border-b border-[color:var(--wb-line)] pb-1 text-xs font-semibold text-[color:var(--wb-ink)]">
        {title} · {entries.length}/{count}
      </h4>
      <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === selectedId}
            onClick={() => onSelect(entry.id)}
            className={`block w-full rounded border px-2 py-1.5 text-left ${entry.id === selectedId ? 'border-[color:var(--wb-ink)] bg-[color:var(--wb-bg)]' : 'border-transparent hover:border-[color:var(--wb-line)]'}`}
          >
            <span className="block text-[11px] font-medium text-[color:var(--wb-ink)]">
              {entry.name}{' '}
              <span className="font-normal text-[color:var(--wb-dim)]">{entry.id}</span>
            </span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-[color:var(--wb-muted)]">
              {entry.summary}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function getGeneratedImageLabel(image: GeneratedImageWithConfig, index: number) {
  const prompt = image.config.prompt?.trim();
  const label = prompt
    ? prompt.replace(/\s+/g, ' ')
    : t('tcg.generatedImage', { index: index + 1 });
  return `${label.slice(0, 76)}${label.length > 76 ? '…' : ''}`;
}

function faceButtonClass(active: boolean) {
  return `rounded border px-2.5 py-1 text-[11px] font-medium ${active ? 'border-[color:var(--wb-ink)] bg-[color:var(--wb-ink)] text-[color:var(--wb-bg)]' : 'border-[color:var(--wb-line)] text-[color:var(--wb-muted)]'}`;
}

async function hasPngSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return (
    bytes.length === signature.length && signature.every((value, index) => bytes[index] === value)
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('tcg.error.readFile', { file: file.name })));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(t('tcg.error.notImage', { file: file.name })));
    };
    reader.readAsDataURL(file);
  });
}

function TcgRecipePicker({
  model,
}: {
  model: Pick<
    TcgComponentStudioViewModel,
    | 'recipeId'
    | 'setRecipe'
    | 'selectedRecipe'
    | 'subjectPrompt'
    | 'setSubjectPrompt'
    | 'generationError'
    | 'handleGenerate'
    | 'isGenerating'
    | 'recipeResolution'
    | 'setFinishId'
    | 'setLayoutId'
  >;
}) {
  const {
    recipeId,
    setRecipe,
    selectedRecipe,
    subjectPrompt,
    setSubjectPrompt,
    generationError,
    handleGenerate,
    isGenerating,
    recipeResolution,
    setFinishId,
    setLayoutId,
  } = model;
  const { t } = useT();

  return (
    <section
      aria-labelledby="tcg-recipe-heading"
      className="space-y-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tcg-recipe-heading" className="text-sm font-semibold text-[color:var(--wb-ink)]">
          {t('tcg.recipe.heading')}
        </h3>
        <span className="text-[10px] text-[color:var(--wb-dim)]">
          {t('tcg.recipe.count', { count: TCG_RECIPES.length })}
        </span>
      </div>
      <label
        htmlFor="tcg-recipe"
        className="block text-xs font-medium text-[color:var(--wb-muted)]"
      >
        {t('tcg.recipe.label')}
      </label>
      <select
        id="tcg-recipe"
        value={recipeId}
        onChange={(event) => setRecipe(event.currentTarget.value as TcgRecipe['id'])}
        className="w-full rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-3 py-2 text-sm text-[color:var(--wb-ink)]"
      >
        {TCG_RECIPES.map((recipe) => (
          <option key={recipe.id} value={recipe.id}>
            {recipe.name} — {recipe.id}
          </option>
        ))}
      </select>
      <p className="text-xs leading-relaxed text-[color:var(--wb-muted)]">
        {selectedRecipe.summary}
      </p>
      <p className="text-[11px] leading-relaxed text-[color:var(--wb-dim)]">
        {t('tcg.recipe.scope', { scope: selectedRecipe.secondaryScope })}
      </p>
      <label
        htmlFor="tcg-subject"
        className="block text-xs font-medium text-[color:var(--wb-muted)]"
      >
        {t('tcg.recipe.subject')}
      </label>
      <textarea
        id="tcg-subject"
        value={subjectPrompt}
        onChange={(event) => setSubjectPrompt(event.currentTarget.value)}
        rows={3}
        placeholder={t('tcg.recipe.subjectPlaceholder')}
        className="w-full resize-y rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-3 py-2 text-sm text-[color:var(--wb-ink)] placeholder:text-[color:var(--wb-dim)]"
      />
      {generationError ? (
        <p role="alert" className="text-xs text-red-700">
          {generationError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="rounded border border-[color:var(--wb-ink)] bg-[color:var(--wb-ink)] px-3 py-2 text-xs font-semibold text-[color:var(--wb-bg)] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isGenerating ? t('tcg.recipe.generating') : t('tcg.recipe.generate')}
        </button>
        <span className="text-[10px] text-[color:var(--wb-dim)]">{t('tcg.recipe.promptNote')}</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2 border-t border-[color:var(--wb-line)] pt-3">
        <p className="max-w-xl text-[11px] leading-relaxed text-[color:var(--wb-muted)]">
          {t('tcg.recipe.defaults', {
            finish: recipeResolution.finish.name,
            layout: recipeResolution.layout.name,
          })}
        </p>
        <button
          type="button"
          onClick={() => {
            setFinishId(selectedRecipe.finishId);
            setLayoutId(selectedRecipe.layoutId);
          }}
          className="rounded border border-[color:var(--wb-line)] px-2 py-1 text-[10px] font-medium text-[color:var(--wb-muted)] hover:text-[color:var(--wb-ink)]"
        >
          {t('tcg.recipe.restore')}
        </button>
      </div>
    </section>
  );
}

function TcgLayoutControls({
  model,
}: {
  model: Pick<
    TcgComponentStudioViewModel,
    | 'layoutId'
    | 'setLayoutId'
    | 'setActiveFace'
    | 'selectedLayout'
    | 'panoramaColumns'
    | 'setPanoramaColumns'
    | 'activeFace'
    | 'finishId'
    | 'setFinishId'
    | 'selectedFinish'
  >;
}) {
  const {
    layoutId,
    setLayoutId,
    setActiveFace,
    selectedLayout,
    panoramaColumns,
    setPanoramaColumns,
    activeFace,
    finishId,
    setFinishId,
    selectedFinish,
  } = model;
  const { t } = useT();

  return (
    <section
      aria-labelledby="tcg-layout-finish-heading"
      className="space-y-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="tcg-layout-finish-heading"
          className="text-sm font-semibold text-[color:var(--wb-ink)]"
        >
          {t('tcg.layout.heading')}
        </h3>
        <span className="text-[10px] text-[color:var(--wb-dim)]">
          {t('tcg.layout.count', { count: TCG_LAYOUTS.length })}
        </span>
      </div>
      <label
        htmlFor="tcg-layout"
        className="block text-xs font-medium text-[color:var(--wb-muted)]"
      >
        {t('tcg.layout.label')}
      </label>
      <select
        id="tcg-layout"
        value={layoutId}
        onChange={(event) => {
          setLayoutId(event.currentTarget.value as TcgLayout['id']);
          setActiveFace(0);
        }}
        className="w-full rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-3 py-2 text-sm text-[color:var(--wb-ink)]"
      >
        {TCG_LAYOUTS.map((layout) => (
          <option key={layout.id} value={layout.id}>
            {layout.name} — {layout.id}
          </option>
        ))}
      </select>
      <p className="text-xs leading-relaxed text-[color:var(--wb-muted)]">
        {selectedLayout.summary}
      </p>
      {layoutId === 'TCG-L008' ? (
        <div className="space-y-1">
          <label
            htmlFor="tcg-panorama-columns"
            className="block text-xs font-medium text-[color:var(--wb-muted)]"
          >
            {t('tcg.layout.gridColumns')}
          </label>
          <select
            id="tcg-panorama-columns"
            value={panoramaColumns}
            onChange={(event) => setPanoramaColumns(Number(event.currentTarget.value) as 2 | 3)}
            className="rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-2 py-1 text-xs text-[color:var(--wb-ink)]"
          >
            <option value={2}>{t('tcg.layout.columns', { count: 2 })}</option>
            <option value={3}>{t('tcg.layout.columns', { count: 3 })}</option>
          </select>
          <p className="text-[10px] text-[color:var(--wb-dim)]">{t('tcg.layout.panoramaNote')}</p>
        </div>
      ) : null}
      {layoutId === 'TCG-L009' ? (
        <div className="flex flex-wrap gap-2" aria-label={t('tcg.layout.faceSelect')}>
          <button
            type="button"
            aria-pressed={activeFace === 0}
            onClick={() => setActiveFace(0)}
            className={faceButtonClass(activeFace === 0)}
          >
            {t('tcg.slot.faceA')}
          </button>
          <button
            type="button"
            aria-pressed={activeFace === 1}
            onClick={() => setActiveFace(1)}
            className={faceButtonClass(activeFace === 1)}
          >
            {t('tcg.slot.faceB')}
          </button>
          <span className="self-center text-[10px] text-[color:var(--wb-dim)]">
            {t('tcg.layout.faceExportNote')}
          </span>
        </div>
      ) : null}
      <div className="border-t border-[color:var(--wb-line)] pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[color:var(--wb-ink)]">
            {t('tcg.finish.heading')}
          </h3>
          <span className="text-[10px] text-[color:var(--wb-dim)]">
            {t('tcg.finish.count', { count: TCG_FINISHES.length })}
          </span>
        </div>
        <label
          htmlFor="tcg-finish"
          className="mt-2 block text-xs font-medium text-[color:var(--wb-muted)]"
        >
          {t('tcg.finish.label')}
        </label>
        <select
          id="tcg-finish"
          value={finishId}
          onChange={(event) => setFinishId(event.currentTarget.value as TcgFinish['id'])}
          className="w-full rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-3 py-2 text-sm text-[color:var(--wb-ink)]"
        >
          {TCG_FINISHES.map((finish) => (
            <option key={finish.id} value={finish.id}>
              {finish.name} — {finish.id}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs leading-relaxed text-[color:var(--wb-muted)]">
          {selectedFinish.summary}
        </p>
        {selectedFinish.caution ? (
          <p className="mt-1 text-[10px] leading-relaxed text-[color:var(--wb-dim)]">
            {selectedFinish.caution}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function TcgArtworkControls({
  model,
}: {
  model: Pick<
    TcgComponentStudioViewModel,
    | 'selectedArtCount'
    | 'requiredArtworkCount'
    | 'artworkChoices'
    | 'getArtworkSlotLabel'
    | 'updateArtworkChoice'
    | 'images'
    | 'handleArtworkUpload'
    | 'cardFields'
    | 'updateCardField'
    | 'layoutId'
  >;
}) {
  const {
    selectedArtCount,
    requiredArtworkCount,
    artworkChoices,
    getArtworkSlotLabel,
    updateArtworkChoice,
    images,
    handleArtworkUpload,
    cardFields,
    updateCardField,
    layoutId,
  } = model;
  const { t } = useT();

  return (
    <section
      aria-labelledby="tcg-artwork-heading"
      className="space-y-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tcg-artwork-heading" className="text-sm font-semibold text-[color:var(--wb-ink)]">
          {t('tcg.art.heading')}
        </h3>
        <span className="text-[10px] text-[color:var(--wb-dim)]">
          {t('tcg.art.ready', { selected: selectedArtCount, required: requiredArtworkCount })}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-[color:var(--wb-muted)]">
        {t('tcg.art.intro')}
      </p>
      {Array.from({ length: requiredArtworkCount }, (_, index) => {
        const choice = artworkChoices[index];
        const sourceSelectValue =
          choice?.kind === 'generated'
            ? choice.imageId
            : choice?.kind === 'upload'
              ? '__uploaded__'
              : '';
        const slotId = `tcg-art-${index + 1}`;
        return (
          <fieldset
            key={slotId}
            className="space-y-2 rounded border border-[color:var(--wb-line)] p-3"
          >
            <legend className="px-1 text-xs font-semibold text-[color:var(--wb-ink)]">
              {getArtworkSlotLabel(index)}
            </legend>
            <label
              htmlFor={`${slotId}-generated`}
              className="block text-[11px] font-medium text-[color:var(--wb-muted)]"
            >
              {t('tcg.art.generatedImage')}
            </label>
            <select
              id={`${slotId}-generated`}
              value={sourceSelectValue}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === '__uploaded__') return;
                updateArtworkChoice(index, value ? { kind: 'generated', imageId: value } : null);
              }}
              className="w-full rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-2 py-2 text-xs text-[color:var(--wb-ink)]"
            >
              <option value="">{t('tcg.art.none')}</option>
              {choice?.kind === 'upload' ? (
                <option value="__uploaded__">
                  {t('tcg.art.localFile', { file: choice.fileName })}
                </option>
              ) : null}
              {images.map((image, imageIndex) => (
                <option key={`${image.id}-${imageIndex}`} value={image.id}>
                  {getGeneratedImageLabel(image, imageIndex)}
                </option>
              ))}
            </select>
            <label
              htmlFor={`${slotId}-file`}
              className="block text-[11px] font-medium text-[color:var(--wb-muted)]"
            >
              {t('tcg.art.orUpload')}
            </label>
            <input
              id={`${slotId}-file`}
              type="file"
              accept="image/*"
              onChange={(event) => {
                void handleArtworkUpload(index, event);
              }}
              className="block w-full text-xs text-[color:var(--wb-muted)] file:mr-2 file:rounded file:border file:border-[color:var(--wb-line)] file:bg-[color:var(--wb-bg)] file:px-2 file:py-1 file:text-xs file:text-[color:var(--wb-ink)]"
            />
            {choice?.kind === 'upload' ? (
              <p className="text-[10px] text-[color:var(--wb-dim)]">
                {t('tcg.art.localFile', { file: choice.fileName })}
              </p>
            ) : null}
            <details className="pt-1">
              <summary className="cursor-pointer text-[11px] font-medium text-[color:var(--wb-muted)]">
                {t('tcg.art.editData')}
              </summary>
              <div className="mt-2 space-y-2">
                <label
                  htmlFor={`${slotId}-name`}
                  className="block text-[10px] font-medium text-[color:var(--wb-muted)]"
                >
                  {t('tcg.art.name')}
                </label>
                <input
                  id={`${slotId}-name`}
                  value={cardFields[index]?.name ?? ''}
                  maxLength={90}
                  onChange={(event) => updateCardField(index, 'name', event.currentTarget.value)}
                  className="w-full rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-2 py-1.5 text-xs text-[color:var(--wb-ink)]"
                />
                <label
                  htmlFor={`${slotId}-type`}
                  className="block text-[10px] font-medium text-[color:var(--wb-muted)]"
                >
                  {t('tcg.art.type')}
                </label>
                <input
                  id={`${slotId}-type`}
                  value={cardFields[index]?.type ?? ''}
                  maxLength={90}
                  onChange={(event) => updateCardField(index, 'type', event.currentTarget.value)}
                  className="w-full rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-2 py-1.5 text-xs text-[color:var(--wb-ink)]"
                />
                <label
                  htmlFor={`${slotId}-rules`}
                  className="block text-[10px] font-medium text-[color:var(--wb-muted)]"
                >
                  {t('tcg.art.rules')}
                </label>
                <textarea
                  id={`${slotId}-rules`}
                  value={cardFields[index]?.rules ?? ''}
                  maxLength={600}
                  rows={3}
                  onChange={(event) => updateCardField(index, 'rules', event.currentTarget.value)}
                  className="w-full resize-y rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] px-2 py-1.5 text-xs text-[color:var(--wb-ink)]"
                />
              </div>
            </details>
          </fieldset>
        );
      })}
      {layoutId === 'TCG-L012' ? (
        <p className="text-[10px] text-[color:var(--wb-dim)]">{t('tcg.art.artPlateNote')}</p>
      ) : null}
    </section>
  );
}

function TcgMaskInputs({
  model,
}: {
  model: Pick<
    TcgComponentStudioViewModel,
    'requiredMaskKeys' | 'layoutId' | 'handleMaskUpload' | 'maskAssets' | 'fileError'
  >;
}): React.ReactElement {
  const { requiredMaskKeys, layoutId, handleMaskUpload, maskAssets, fileError } = model;
  const { t } = useT();

  return (
    <section
      aria-labelledby="tcg-masks-heading"
      className="space-y-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tcg-masks-heading" className="text-sm font-semibold text-[color:var(--wb-ink)]">
          {t('tcg.mask.heading')}
        </h3>
        <span className="text-[10px] text-[color:var(--wb-dim)]">
          {requiredMaskKeys.length} PNG
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-[color:var(--wb-muted)]">
        {t('tcg.mask.intro')}
      </p>
      {layoutId === 'TCG-L005' ? (
        <p className="rounded border border-amber-700/30 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-950">
          {t('tcg.mask.frameBreak')}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {requiredMaskKeys.map((key) => {
          const id = `tcg-mask-${key}`;
          return (
            <div key={key} className="space-y-1 rounded border border-[color:var(--wb-line)] p-2">
              <label
                htmlFor={id}
                className="block text-[11px] font-medium text-[color:var(--wb-ink)]"
              >
                {t('tcg.mask.required', { key })}
              </label>
              <input
                id={id}
                type="file"
                accept="image/png,.png"
                onChange={(event) => {
                  void handleMaskUpload(key, event);
                }}
                className="block w-full text-[10px] text-[color:var(--wb-muted)] file:mr-1 file:rounded file:border file:border-[color:var(--wb-line)] file:bg-[color:var(--wb-bg)] file:px-1.5 file:py-1 file:text-[10px] file:text-[color:var(--wb-ink)]"
              />
              {maskAssets[key] ? (
                <p className="text-[10px] text-emerald-800">
                  {t('tcg.mask.loaded', { file: maskAssets[key].fileName })}
                </p>
              ) : (
                <p className="text-[10px] text-[color:var(--wb-dim)]">{t('tcg.mask.none')}</p>
              )}
            </div>
          );
        })}
      </div>
      {fileError ? (
        <p role="alert" className="text-xs text-red-700">
          {fileError}
        </p>
      ) : null}
    </section>
  );
}

function TcgCompositionPreview({
  model,
}: {
  model: React.ComponentProps<typeof TcgComponentStudioView>['model'];
}) {
  const {
    layoutId,
    activeFace,
    exportPng,
    canExport,
    selectedReasons,
    canvasRef,
    rendering,
    renderError,
  } = model;
  const { t } = useT();
  return (
    <section
      aria-labelledby="tcg-preview-heading"
      className="space-y-3 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tcg-preview-heading" className="text-sm font-semibold text-[color:var(--wb-ink)]">
          {t('tcg.preview.heading')}
        </h3>
        <button
          type="button"
          onClick={exportPng}
          disabled={!canExport}
          title={canExport ? t('tcg.preview.exportTitle') : selectedReasons.join(' ')}
          className="rounded border border-[color:var(--wb-ink)] px-3 py-2 text-xs font-semibold text-[color:var(--wb-ink)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {t('tcg.preview.export')}
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-[color:var(--wb-muted)]">
        {layoutId === 'TCG-L007'
          ? t('tcg.preview.diptych')
          : layoutId === 'TCG-L008'
            ? t('tcg.preview.panorama')
            : layoutId === 'TCG-L009'
              ? t('tcg.preview.face', { face: activeFace === 0 ? 'A' : 'B' })
              : t('tcg.preview.default')}
      </p>
      <div className="flex min-h-64 items-center justify-center overflow-auto rounded border border-[color:var(--wb-line)] bg-[#20252b] p-3">
        <canvas
          ref={canvasRef}
          aria-label={t('tcg.preview.canvasLabel')}
          className="block h-auto max-h-[72vh] max-w-full rounded shadow-lg"
        />
      </div>
      {rendering ? (
        <p role="status" className="text-xs text-[color:var(--wb-muted)]">
          {t('tcg.preview.updating')}
        </p>
      ) : null}
      {renderError ? (
        <p role="alert" className="text-xs text-red-700">
          {renderError}
        </p>
      ) : null}
      {!renderError && !canExport ? (
        <div
          role="status"
          className="space-y-1 rounded border border-[color:var(--wb-line)] bg-[color:var(--wb-bg)] p-3"
        >
          <p className="text-xs font-medium text-[color:var(--wb-ink)]">
            {t('tcg.preview.completeAssets')}
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-[10px] text-[color:var(--wb-muted)]">
            {selectedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[10px] leading-relaxed text-[color:var(--wb-dim)]">
        {t('tcg.preview.disclaimer')}
      </p>
    </section>
  );
}
