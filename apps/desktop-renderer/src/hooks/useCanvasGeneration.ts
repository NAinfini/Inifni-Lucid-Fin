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
import { addLog } from '../store/slices/logger.js';
import { getAPI } from '../utils/api.js';

function serializeGenerationDetail(detail: Record<string, unknown>, error?: unknown): string {
  const payload: Record<string, unknown> = { ...detail };
  if (error instanceof Error) {
    payload.error = error.message;
    payload.stack = error.stack;
  } else if (error !== undefined) {
    payload.error = String(error);
  }
  return JSON.stringify(payload, null, 2);
}

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
      dispatch(setNodeProgress({ id: data.nodeId, progress: data.progress, currentStep: data.currentStep }));
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
      dispatch(
        addLog({
          level: 'info',
          category: 'generation',
          message: 'Canvas generation completed',
          detail: serializeGenerationDetail({
            canvasId: data.canvasId,
            nodeId: data.nodeId,
            variantCount: data.variants.length,
            primaryAssetHash: data.primaryAssetHash,
            cost: data.cost,
            generationTimeMs: data.generationTimeMs,
          }),
        }),
      );
    });
    const unsubFailed = api.canvasGeneration.onFailed((data) => {
      if (data.canvasId !== activeCanvasId) return;
      dispatch(setNodeGenerationFailed({ id: data.nodeId, error: data.error }));
      dispatch(
        addLog({
          level: 'error',
          category: 'generation',
          message: 'Canvas generation failed',
          detail: serializeGenerationDetail({
            canvasId: data.canvasId,
            nodeId: data.nodeId,
          }, data.error),
        }),
      );
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

      dispatch(
        addLog({
          level: 'info',
          category: 'generation',
          message: 'Canvas generation requested',
          detail: serializeGenerationDetail({
            canvasId: activeCanvasId,
            nodeId,
            providerId,
            variantCount,
            seed,
          }),
        }),
      );
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
        dispatch(
          addLog({
            level: 'info',
            category: 'generation',
            message: 'Canvas generation queued',
            detail: serializeGenerationDetail({
              canvasId: activeCanvasId,
              nodeId,
              jobId: result.jobId,
              providerId,
            }),
          }),
        );
      } catch (error) {
        dispatch(
          setNodeGenerationFailed({
            id: nodeId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        dispatch(
          addLog({
            level: 'error',
            category: 'generation',
            message: 'Canvas generation failed',
            detail: serializeGenerationDetail({
              canvasId: activeCanvasId,
              nodeId,
              providerId,
              variantCount,
              seed,
            }, error),
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
      dispatch(
        addLog({
          level: 'info',
          category: 'generation',
          message: 'Canvas generation cancel requested',
          detail: serializeGenerationDetail({
            canvasId: activeCanvasId,
            nodeId,
          }),
        }),
      );
      try {
        await api.canvasGeneration.cancel(activeCanvasId, nodeId);
        dispatch(
          addLog({
            level: 'info',
            category: 'generation',
            message: 'Canvas generation cancel completed',
            detail: serializeGenerationDetail({
              canvasId: activeCanvasId,
              nodeId,
            }),
          }),
        );
      } catch (error) {
        dispatch(
          addLog({
            level: 'error',
            category: 'generation',
            message: 'Canvas generation cancel failed',
            detail: serializeGenerationDetail({
              canvasId: activeCanvasId,
              nodeId,
            }, error),
          }),
        );
        throw error;
      }
    },
    [activeCanvasId, dispatch],
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
      try {
        const result = await api.canvasGeneration.estimateCost(activeCanvasId, nodeId, providerId);
        dispatch(setNodeEstimatedCost({ id: nodeId, estimatedCost: result.estimatedCost }));
        dispatch(
          addLog({
            level: 'info',
            category: 'generation',
            message: 'Canvas generation cost estimated',
            detail: serializeGenerationDetail({
              canvasId: activeCanvasId,
              nodeId,
              providerId,
              estimatedCost: result.estimatedCost,
              currency: result.currency,
            }),
          }),
        );
        return result.estimatedCost;
      } catch (error) {
        dispatch(
          addLog({
            level: 'error',
            category: 'generation',
            message: 'Canvas generation cost estimate failed',
            detail: serializeGenerationDetail({
              canvasId: activeCanvasId,
              nodeId,
              providerId,
            }, error),
          }),
        );
        throw error;
      }
    },
    [activeCanvasId, dispatch],
  );

  return { generate, cancel, estimateCost };
}
