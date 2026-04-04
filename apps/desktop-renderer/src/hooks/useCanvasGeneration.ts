import { useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../store/index.js';
import {
  setNodeEstimatedCost,
  setNodeGenerationComplete,
  setNodeGenerationFailed,
  setNodeGenerating,
  setNodeProgress,
} from '../store/slices/canvas.js';
import { getAPI } from '../utils/api.js';

export function useCanvasGeneration(): {
  generate: (
    nodeId: string,
    providerId?: string,
    variantCount?: number,
    seed?: number,
  ) => Promise<void>;
  cancel: (nodeId: string) => Promise<void>;
  estimateCost: (nodeId: string, providerId: string) => Promise<number>;
} {
  const dispatch = useDispatch<AppDispatch>();
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);

  useEffect(() => {
    const api = getAPI();
    if (!api?.canvasGeneration || !activeCanvasId) return;

    const unsubProgress = api.canvasGeneration.onProgress((data) => {
      if (data.canvasId !== activeCanvasId) return;
      dispatch(setNodeProgress({ id: data.nodeId, progress: data.progress }));
    });
    const unsubComplete = api.canvasGeneration.onComplete((data) => {
      if (data.canvasId !== activeCanvasId) return;
      dispatch(
        setNodeGenerationComplete({
          id: data.nodeId,
          variants: data.variants,
          primaryAssetHash: data.primaryAssetHash,
          cost: data.cost,
          generationTimeMs: data.generationTimeMs,
        }),
      );
    });
    const unsubFailed = api.canvasGeneration.onFailed((data) => {
      if (data.canvasId !== activeCanvasId) return;
      dispatch(setNodeGenerationFailed({ id: data.nodeId, error: data.error }));
    });

    return () => {
      unsubProgress();
      unsubComplete();
      unsubFailed();
    };
  }, [activeCanvasId, dispatch]);

  const generate = useCallback(
    async (nodeId: string, providerId?: string, variantCount?: number, seed?: number) => {
      const api = getAPI();
      if (!api?.canvasGeneration) {
        throw new Error('canvasGeneration API unavailable');
      }
      if (!activeCanvasId) {
        throw new Error('No active canvas selected');
      }

      dispatch(setNodeGenerating({ id: nodeId, jobId: `pending-${Date.now()}` }));
      try {
        const result = await api.canvasGeneration.generate(
          activeCanvasId,
          nodeId,
          providerId,
          variantCount,
          seed,
        );
        dispatch(setNodeGenerating({ id: nodeId, jobId: result.jobId }));
      } catch (error) {
        dispatch(
          setNodeGenerationFailed({
            id: nodeId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
    [activeCanvasId, dispatch],
  );

  const cancel = useCallback(
    async (nodeId: string) => {
      const api = getAPI();
      if (!api?.canvasGeneration) {
        throw new Error('canvasGeneration API unavailable');
      }
      if (!activeCanvasId) {
        throw new Error('No active canvas selected');
      }
      await api.canvasGeneration.cancel(activeCanvasId, nodeId);
    },
    [activeCanvasId],
  );

  const estimateCost = useCallback(
    async (nodeId: string, providerId: string) => {
      const api = getAPI();
      if (!api?.canvasGeneration) {
        throw new Error('canvasGeneration API unavailable');
      }
      if (!activeCanvasId) {
        throw new Error('No active canvas selected');
      }
      const result = await api.canvasGeneration.estimateCost(activeCanvasId, nodeId, providerId);
      dispatch(setNodeEstimatedCost({ id: nodeId, estimatedCost: result.estimatedCost }));
      return result.estimatedCost;
    },
    [activeCanvasId, dispatch],
  );

  return { generate, cancel, estimateCost };
}
