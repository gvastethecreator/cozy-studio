import { useGenerationDraft } from '../../contexts/GenerationContext';
import { useToastUi } from '../../contexts/GlobalContext';
import { addToastToStore, removeToastFromStore } from '../../contexts/toastStore';
import type { ChatgptUsageCopy } from '../../packages/shared/src/chatgptUsage';
import { providerBrandChipLabel } from '../../lib/providerBrand';
import type { ImageGenerationConfig } from '../../types';
import { OutputBackgroundControl } from '../create/OutputBackgroundControl';
import type { Attachment } from '../../types';
import { getCatalogRegenerateIssue } from '../../utils/catalogImageGenerationConfig';
import { AnimatePresence } from '../../lib/gsapMotion';
import React, { Suspense } from 'react';

import { ErrorBoundary } from '../ErrorBoundary';
import ImageCarousel from '../ImageCarousel';
import { LazySurfaceFallback } from '../ui/LazySurfaceFallback';
import type { StudioImageOverlaysProps } from './types';

const ImageEditorModal = React.lazy(() =>
  import('../ImageEditorModal').then((m) => ({ default: m.ImageEditorModal })),
);

function EditorBackground({ image, providerId }: { image: Attachment; providerId: string }) {
  const { generationConfig, updateGenerationConfig } = useGenerationDraft();
  return (
    <OutputBackgroundControl
      config={{ ...generationConfig, recipeId: null, recipeParams: null, attachments: [image] }}
      providerId={providerId}
      onChange={(value) => updateGenerationConfig('outputBackground', value)}
    />
  );
}

/** A variation waits this long before it is sent, so Cancel always stops it before it runs. */
const VARIATION_HOLD_MS = 5000;

/** "1 variation · ChatGPT · uses credits": what the variation runs on and what it spends. */
export function describeVariation(
  config: Pick<ImageGenerationConfig, 'batchCount'>,
  providerId: string,
  chatgptUsage: ChatgptUsageCopy | null,
) {
  const count = Math.max(1, config.batchCount || 1);
  const usage =
    providerId !== 'chatgpt' || !chatgptUsage
      ? null
      : chatgptUsage.blocksGeneration
        ? chatgptUsage.short
        : chatgptUsage.state === 'credits'
          ? 'uses credits'
          : null;
  return [`${count} variation${count === 1 ? '' : 's'}`, providerBrandChipLabel(providerId), usage]
    .filter(Boolean)
    .join(' · ');
}

export const StudioImageOverlays: React.FC<
  StudioImageOverlaysProps & { providerId: string; chatgptUsage?: ChatgptUsageCopy | null }
> = ({
  providerId,
  chatgptUsage = null,
  modalImage,
  imagesWithConfig,
  activeGenerationConfig,
  closeModal,
  handleDelete,
  handleGenerate,
  handleAddToContext,
  handleLoadRecipe,
  handleToggleFavorite,
  setActiveCarouselId,
  isEditorOpen,
  closeEditor,
  imageToEdit,
  editorDrafts,
  handleExecuteEdit,
  isEditingImage,
  imageEditNotice,
  requireMask = true,
}) => {
  const { addToast } = useToastUi();
  const { draftScopeKey } = useGenerationDraft();
  const editorKey = `${draftScopeKey}:${imageToEdit?.localPath || imageToEdit?.sourceUrl || imageToEdit?.dataUrl || ''}`;
  return (
    <>
      {modalImage && (
        <ImageCarousel
          activeImage={modalImage}
          allImages={imagesWithConfig}
          activeGenerationConfig={activeGenerationConfig}
          onClose={closeModal}
          onDelete={handleDelete}
          describeVariation={(config) => describeVariation(config, providerId, chatgptUsage)}
          onRegenerate={(config) => {
            const issue = getCatalogRegenerateIssue(config);
            if (issue) {
              addToast(issue, 'info');
              return;
            }
            // Hold the job in the browser first: once queued, a free worker can start it at once.
            const timer = window.setTimeout(() => {
              removeToastFromStore(toastId);
              handleGenerate(config.prompt, config, { preventModal: true });
            }, VARIATION_HOLD_MS);
            const toastId = addToastToStore(
              `Generating ${describeVariation(config, providerId, chatgptUsage)} in 5 seconds.`,
              'info',
              VARIATION_HOLD_MS,
              {
                label: 'Cancel',
                run: () => {
                  window.clearTimeout(timer);
                  removeToastFromStore(toastId);
                  addToast('Variation cancelled. Nothing was sent.', 'info');
                },
              },
            );
          }}
          onAddToContext={(image) => {
            handleAddToContext(image);
            closeModal();
          }}
          onLoadConfig={async (config, options) => {
            if (await handleLoadRecipe(config, options)) closeModal();
          }}
          onToggleFavorite={handleToggleFavorite}
          onActiveImageChange={setActiveCarouselId}
          transitionName="master-canvas"
        />
      )}
      <AnimatePresence>
        {isEditorOpen && (
          <ErrorBoundary fallbackMessage="Could not load the image editor.">
            <Suspense
              fallback={
                <LazySurfaceFallback
                  label="Loading editor"
                  className="fixed inset-0 z-50 grid place-items-center studio-scrim"
                />
              }
            >
              <ImageEditorModal
                key={editorKey}
                isOpen={isEditorOpen}
                onClose={closeEditor}
                image={imageToEdit}
                onGenerate={handleExecuteEdit}
                isGenerating={isEditingImage}
                notice={imageEditNotice}
                requireMask={requireMask}
                draft={editorDrafts.get(editorKey)}
                onDraftChange={(draft) => {
                  if (draft) editorDrafts.set(editorKey, draft);
                  else editorDrafts.delete(editorKey);
                }}
                backgroundControl={
                  imageToEdit ? (
                    <EditorBackground image={imageToEdit} providerId={providerId} />
                  ) : null
                }
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </AnimatePresence>
    </>
  );
};
