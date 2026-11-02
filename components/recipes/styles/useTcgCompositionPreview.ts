import { useEffect, useRef, useState } from 'react';
import type { TcgArtworkSource, TcgRenderInput } from './tcgCardRenderer';
import { renderTcgComposition } from './tcgCardRenderer';
import { t, useT } from '../../../lib/i18n';

export interface TcgRenderHealth {
  input: TcgRenderInput;
  missingMaskKeys: string[];
  failedArtworkSlots: number[];
  failedMaskKeys: string[];
}

export function getTcgCompositionReadiness({
  artwork,
  requiredArtworkCount,
  requiredMaskKeys,
  maskSources,
  renderInput,
  renderHealth,
  rendering,
  renderError,
}: {
  artwork: readonly TcgArtworkSource[];
  requiredArtworkCount: number;
  requiredMaskKeys: readonly string[];
  maskSources: Record<string, string>;
  renderInput: TcgRenderInput;
  renderHealth: TcgRenderHealth | null;
  rendering: boolean;
  renderError: string;
}) {
  const selectedArtCount = artwork
    .slice(0, requiredArtworkCount)
    .filter((entry) => !!entry.src).length;
  const missingArtSlots = requiredArtworkCount - selectedArtCount;
  const missingMaskKeys = new Set(renderHealth?.missingMaskKeys);
  const outstandingMasks = requiredMaskKeys.filter(
    (key) => !maskSources[key] || missingMaskKeys.has(key),
  );
  const invalidMasks = renderHealth?.failedMaskKeys ?? [];
  const invalidArt = renderHealth?.failedArtworkSlots ?? [];
  const canExport =
    renderHealth?.input === renderInput &&
    !rendering &&
    !renderError &&
    missingArtSlots === 0 &&
    outstandingMasks.length === 0 &&
    invalidMasks.length === 0 &&
    invalidArt.length === 0;
  const selectedReasons = [
    ...outstandingMasks.map((key) => t('tcg.reason.missingMask', { key })),
    ...invalidMasks.map((key) => t('tcg.reason.invalidMask', { key })),
    ...invalidArt.map((index) => t('tcg.reason.invalidArt', { index: index + 1 })),
    ...(missingArtSlots > 0 ? [t('tcg.reason.missingArt', { count: missingArtSlots })] : []),
  ];
  return { selectedArtCount, canExport, selectedReasons };
}

export function useTcgCompositionPreview(renderInput: TcgRenderInput) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderHealth, setRenderHealth] = useState<TcgRenderHealth | null>(null);
  // The empty art slot draws a translated label on the canvas.
  const { language } = useT();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    setRendering(true);
    setRenderError('');
    const timer = window.setTimeout(() => {
      void renderTcgComposition(renderInput)
        .then((result) => {
          if (cancelled) return;
          canvas.width = result.width;
          canvas.height = result.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error(t('tcg.error.drawPreview'));
          context.clearRect(0, 0, result.width, result.height);
          context.drawImage(result.canvas, 0, 0);
          setRenderHealth({
            input: renderInput,
            missingMaskKeys: result.missingMaskKeys,
            failedArtworkSlots: result.failedArtworkSlots,
            failedMaskKeys: result.failedMaskKeys,
          });
          setRendering(false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setRenderError(error instanceof Error ? error.message : t('tcg.error.renderComposition'));
          setRenderHealth(null);
          setRendering(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [renderInput, language]);

  return { canvasRef, renderError, setRenderError, rendering, renderHealth };
}
