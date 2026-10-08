import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  Movie as Clapperboard,
  VideoCamera as Video,
  Lens as Aperture,
  Movie as Film,
  Xmark as X,
  SunLight as Sun,
  ViewGrid as Grid3X3,
  Clock,
  Rain as CloudRain,
  ViewColumns2 as LayoutTemplate,
  Square as RectangleHorizontal,
  Upload,
} from 'iconoir-react';
import type { Attachment, ImageGenerationConfig } from '../../types';
import { RATIO_MAP } from '../../constants';
import { useRecipeContextRegistration } from '../../hooks/useRecipeContextRegistration';
import { RecipeLayout } from './RecipeLayout';
import { ControlDropdown } from './RecipeUI';
import { QuickStartText } from './QuickStartText';
import {
  getRecipeModuleUiModel,
  getRecipeNumberDefault,
  getRecipeNumberOptions,
  getRecipeOptions,
  getRecipeStringDefault,
} from './recipeModuleUi';

interface CinematicRecipeProps {
  config: ImageGenerationConfig;
  updateConfig: <K extends keyof ImageGenerationConfig>(
    key: K,
    value: ImageGenerationConfig[K],
  ) => void;
  updateAttachment: (id: string, newProps: Partial<Attachment>) => void;
  onFileSelect: (files: File[]) => void;
  onGenerate: (prompt?: string) => void;
  isGenerating: boolean;
}

const { module: CINEMATIC_MODULE, defaults: CINEMATIC_DEFAULTS } =
  getRecipeModuleUiModel('cinematic');

const CONTROL_OPTIONS = {
  genre: getRecipeOptions(CINEMATIC_MODULE, 'genre'),
  tone: getRecipeOptions(CINEMATIC_MODULE, 'tone'),
  lighting: getRecipeOptions(CINEMATIC_MODULE, 'lighting'),
  time: getRecipeOptions(CINEMATIC_MODULE, 'time'),
  weather: getRecipeOptions(CINEMATIC_MODULE, 'weather'),
  movement: getRecipeOptions(CINEMATIC_MODULE, 'movement'),
  lens: getRecipeOptions(CINEMATIC_MODULE, 'lens'),
};

const FRAME_COUNTS = getRecipeNumberOptions(CINEMATIC_MODULE, 'frames');
const SHOT_TYPES = getRecipeOptions(CINEMATIC_MODULE, 'frameShots');

const DEFAULT_PARAMS = {
  frames: getRecipeNumberDefault(CINEMATIC_DEFAULTS, 'frames', 9),
  genre: getRecipeStringDefault(CINEMATIC_DEFAULTS, 'genre', 'Auto-Detect'),
  tone: getRecipeStringDefault(CINEMATIC_DEFAULTS, 'tone', 'Auto-Detect'),
  lighting: getRecipeStringDefault(CINEMATIC_DEFAULTS, 'lighting', 'Auto-Detect'),
  time: getRecipeStringDefault(CINEMATIC_DEFAULTS, 'time', 'Auto-Detect'),
  weather: getRecipeStringDefault(CINEMATIC_DEFAULTS, 'weather', 'Auto-Detect'),
  movement: getRecipeStringDefault(CINEMATIC_DEFAULTS, 'movement', 'Auto-Detect'),
  lens: getRecipeStringDefault(CINEMATIC_DEFAULTS, 'lens', 'Auto-Detect'),
};

// Storyboard panels read best as landscape film frames.
const CINEMATIC_PANEL_ASPECT = 16 / 9;

/** Pick the rows x columns split whose panels come closest to a 16:9 film frame. */
function getCinematicGrid(frames: number, sheetAspect: number) {
  let best = { rows: 1, cols: frames };
  let bestScore = Infinity;
  for (let rows = 1; rows <= frames; rows += 1) {
    if (frames % rows !== 0) continue;
    const cols = frames / rows;
    const score = Math.abs(Math.log((sheetAspect * rows) / cols / CINEMATIC_PANEL_ASPECT));
    // On a tie, the later split has wider panels; keep it.
    if (score <= bestScore + 1e-9) {
      best = { rows, cols };
      bestScore = score;
    }
  }
  return best;
}

export const CinematicRecipe: React.FC<CinematicRecipeProps> = ({
  config,
  updateConfig,
  updateAttachment,
  onFileSelect,
  onGenerate,
  isGenerating,
}) => {
  const [params, setParams] = useState(
    () =>
      ({
        ...DEFAULT_PARAMS,
        ...(config.recipeId === 'cinematic' ? config.recipeParams : {}),
      }) as typeof DEFAULT_PARAMS,
  );

  const [frameShots, setFrameShots] = useState<Record<number, string>>(
    () => (config.recipeParams?.frameShots as Record<number, string>) ?? {},
  );

  const [selectedFrame, setSelectedFrame] = useState(0);
  const activeFrame = Math.min(selectedFrame, params.frames - 1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeImage = config.attachments[0];
  const ratioValue = useMemo(() => RATIO_MAP[config.aspectRatio] || 1.777, [config.aspectRatio]);

  const handleFrameChange = useCallback((count: number) => {
    setParams((p) => ({ ...p, frames: count }));
  }, []);

  const gridLayout = useMemo(
    () => getCinematicGrid(params.frames, ratioValue),
    [params.frames, ratioValue],
  );

  // Hidden panels keep their pick while the editor is open, but only visible panels are sent.
  const visibleFrameShots = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(frameShots).filter(([index]) => Number(index) < params.frames),
      ),
    [frameShots, params.frames],
  );

  const recipeParams = useMemo(
    () => ({
      frames: params.frames,
      rows: gridLayout.rows,
      cols: gridLayout.cols,
      aspectRatio: config.aspectRatio,
      frameShots: visibleFrameShots,
      genre: params.genre,
      tone: params.tone,
      lighting: params.lighting,
      time: params.time,
      weather: params.weather,
      movement: params.movement,
      lens: params.lens,
    }),
    [
      config.aspectRatio,
      gridLayout.cols,
      gridLayout.rows,
      params.frames,
      params.genre,
      params.lens,
      params.lighting,
      params.movement,
      params.time,
      params.tone,
      params.weather,
      visibleFrameShots,
    ],
  );

  useRecipeContextRegistration(updateConfig, 'cinematic', recipeParams);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/'));
    if (files.length > 0) onFileSelect(files);
  };

  const BottomDock = useMemo(
    () => (
      <>
        <div className="flex flex-col gap-1.5">
          <span className="text-[length:var(--wbp-label)] font-semibold text-[color:var(--wb-muted)] tracking-normal pl-1">
            Layout
          </span>
          <div className="flex items-center gap-2 p-1 bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)] rounded-[var(--wb-radius)] border border-[color:var(--wb-line)]">
            {FRAME_COUNTS.map((count) => (
              <button
                type="button"
                key={count}
                aria-pressed={params.frames === count}
                onClick={() => handleFrameChange(count)}
                className={`h-9 px-4 rounded-[var(--wb-radius)] flex items-center gap-2 transition-[background-color,color,box-shadow,transform] ${
                  params.frames === count
                    ? 'bg-[color:var(--wb-accent)] text-[color:var(--wb-on-accent)] ring-1 ring-current'
                    : 'text-[color:var(--wb-muted)] hover:text-[color:var(--wb-ink)] hover:bg-[color-mix(in_srgb,var(--wb-ink)_6%,transparent)]'
                }`}
              >
                {count === 3 && <LayoutTemplate width={14} height={14} />}
                {count === 6 && <RectangleHorizontal width={14} height={14} />}
                {count === 9 && <Grid3X3 width={14} height={14} />}
                <span className="text-[length:var(--wbp-label)] font-semibold">{count} Scenes</span>
              </button>
            ))}
          </div>
        </div>

        <div className="h-10 w-px bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] mx-2 hidden xl:block" />

        <div className="flex items-center gap-3 flex-wrap justify-center">
          <ControlDropdown
            title="Time"
            icon={<Clock width={14} height={14} />}
            label={params.time}
            options={CONTROL_OPTIONS.time}
            onSelect={(v) => setParams((p) => ({ ...p, time: v }))}
          />
          <ControlDropdown
            title="Weather"
            icon={<CloudRain width={14} height={14} />}
            label={params.weather}
            options={CONTROL_OPTIONS.weather}
            onSelect={(v) => setParams((p) => ({ ...p, weather: v }))}
          />
          <ControlDropdown
            title="Lighting"
            icon={<Sun width={14} height={14} />}
            label={params.lighting}
            options={CONTROL_OPTIONS.lighting}
            onSelect={(v) => setParams((p) => ({ ...p, lighting: v }))}
          />
        </div>

        <div className="h-10 w-px bg-[color-mix(in_srgb,var(--wb-ink)_8%,transparent)] mx-2 hidden xl:block" />

        <ControlDropdown
          title={`Scene ${activeFrame + 1} shot`}
          icon={<Clapperboard width={14} height={14} />}
          label={frameShots[activeFrame] || 'Auto'}
          options={SHOT_TYPES}
          onSelect={(value) => setFrameShots((previous) => ({ ...previous, [activeFrame]: value }))}
        />
        <details className="recipe-advanced">
          <summary>Advanced camera and mood</summary>
          <div className="recipe-advanced-grid">
            <ControlDropdown
              title="Genre"
              icon={<Film width={14} height={14} />}
              label={params.genre}
              options={CONTROL_OPTIONS.genre}
              onSelect={(v) => setParams((p) => ({ ...p, genre: v }))}
            />
            <ControlDropdown
              title="Tone"
              icon={<Aperture width={14} height={14} />}
              label={params.tone}
              options={CONTROL_OPTIONS.tone}
              onSelect={(v) => setParams((p) => ({ ...p, tone: v }))}
            />
            <ControlDropdown
              title="Camera"
              icon={<Video width={14} height={14} />}
              label={params.movement}
              options={CONTROL_OPTIONS.movement}
              onSelect={(v) => setParams((p) => ({ ...p, movement: v }))}
            />
            <ControlDropdown
              title="Lens"
              icon={<Clapperboard width={14} height={14} />}
              label={params.lens}
              options={CONTROL_OPTIONS.lens}
              onSelect={(v) => setParams((p) => ({ ...p, lens: v }))}
            />
          </div>
        </details>
      </>
    ),
    [params, handleFrameChange, activeFrame, frameShots],
  );

  return (
    <RecipeLayout
      editorLabel="Storyboard"
      isGenerating={isGenerating}
      bottomDock={BottomDock}
      className="flex min-h-0 flex-col"
    >
      <div
        className="relative overflow-hidden rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:var(--wb-panel)] shadow-2xl transition-[background-color,border-color,box-shadow,transform] duration-500 ease-out-expo group"
        style={{
          aspectRatio: ratioValue,
          width: `min(90vw, 74vh, calc((100dvh - var(--studio-chrome-block)) * ${ratioValue}))`,
          maxWidth: '100%',
          maxHeight: 'calc(100dvh - var(--studio-chrome-block))',
        }}
      >
        {activeImage && (
          <img
            src={activeImage.dataUrl}
            alt="Ref"
            className="pointer-events-none absolute inset-0 size-full object-cover opacity-20 blur-sm grayscale transition-[filter,opacity] duration-700 group-hover:grayscale-0"
          />
        )}

        <div
          className="pointer-events-none absolute inset-0 grid gap-px transition-colors duration-500"
          style={{
            gridTemplateColumns: `repeat(${gridLayout.cols}, 1fr)`,
            gridTemplateRows: `repeat(${gridLayout.rows}, 1fr)`,
          }}
        >
          {Array.from({ length: params.frames }).map((_, i) => (
            <button
              type="button"
              aria-label={`Select scene ${i + 1}`}
              aria-pressed={activeFrame === i}
              onClick={() => setSelectedFrame(i)}
              key={i}
              className="relative min-w-0 bg-white/[0.02] backdrop-blur-[1px] flex flex-col items-center justify-center border border-[color:var(--wb-line)] group/cell pointer-events-auto aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-[color:var(--wb-accent)]"
            >
              <span className="text-[length:var(--wbp-label)] font-semibold text-[color:var(--wb-muted)] group-hover/cell:text-[color:var(--wb-ink)] tracking-normal transition-colors mb-2">
                {i === 0 ? 'START' : i === params.frames - 1 ? 'END' : `SCENE ${i + 1}`}
              </span>
              <span className="text-xs text-[color:var(--wb-muted)]">
                {frameShots[i] || 'Auto'}
              </span>
            </button>
          ))}
        </div>

        {activeImage && (
          <button
            type="button"
            aria-label="Remove cinematic reference"
            onClick={() =>
              updateConfig(
                'attachments',
                config.attachments.filter((attachment) => attachment.id !== activeImage.id),
              )
            }
            className="pointer-events-auto absolute right-2 top-2 z-20 rounded-[var(--wb-radius)] border border-[color:var(--wb-line)] bg-[color:color-mix(in_srgb,var(--wba-bg)_72%,#000)] p-1 text-[color:var(--wb-ink)] transition-[background-color,color] hover:bg-red-500 hover:text-[color:var(--wb-ink)]"
          >
            <X width={14} height={14} />
          </button>
        )}
      </div>
    </RecipeLayout>
  );
};
