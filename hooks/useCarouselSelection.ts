import { useCallback, useState } from 'react';

/** The preview selection survives closing the expanded viewer. */
export function useCarouselSelection(
  workspaceId: string,
  modalImageId: string | null,
  modalOpen: boolean,
) {
  const [selection, setSelection] = useState<{ workspaceId: string; id: string } | null>(null);
  let id = selection?.workspaceId === workspaceId ? selection.id : null;
  const select = useCallback((id: string) => setSelection({ workspaceId, id }), [workspaceId]);
  if (modalOpen && modalImageId && modalImageId !== id) {
    setSelection({ workspaceId, id: modalImageId });
    id = modalImageId;
  }
  return { id, select };
}
