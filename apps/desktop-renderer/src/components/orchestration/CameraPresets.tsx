import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Camera } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { updateCamera } from '../../store/slices/orchestration.js';
import { t } from '../../i18n.js';

const PRESETS = [
  { id: 'wide', labelKey: 'cameraPresets.preset.wide', focal: 24, dof: 0.3 },
  { id: 'medium', labelKey: 'cameraPresets.preset.medium', focal: 50, dof: 0.5 },
  { id: 'close-up', labelKey: 'cameraPresets.preset.closeUp', focal: 85, dof: 0.8 },
  { id: 'over-shoulder', labelKey: 'cameraPresets.preset.overShoulder', focal: 35, dof: 0.6 },
  { id: 'birds-eye', labelKey: 'cameraPresets.preset.birdsEye', focal: 16, dof: 0.2 },
  { id: 'low-angle', labelKey: 'cameraPresets.preset.lowAngle', focal: 28, dof: 0.4 },
  { id: 'dutch', labelKey: 'cameraPresets.preset.dutch', focal: 35, dof: 0.5 },
];

const LAYOUTS = [
  { id: 'single', labelKey: 'cameraPresets.layout.single' },
  { id: 'split-h', labelKey: 'cameraPresets.layout.splitH' },
  { id: 'split-v', labelKey: 'cameraPresets.layout.splitV' },
  { id: 'quad', labelKey: 'cameraPresets.layout.quad' },
  { id: 'pip', labelKey: 'cameraPresets.layout.pip' },
];

export function CameraPresets() {
  const dispatch = useDispatch();
  const selectedId = useSelector((s: RootState) => s.orchestration.selectedId);
  const segment = useSelector((s: RootState) =>
    s.orchestration.segments.find((seg) => seg.id === selectedId),
  );

  if (!selectedId || !segment) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        {t('cameraPresets.selectSegment')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Camera presets */}
      <div>
        <div className="flex items-center gap-1 mb-2">
          <Camera className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs font-medium">{t('cameraPresets.title')}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() =>
                dispatch(
                  updateCamera({
                    segmentId: selectedId,
                    camera: {
                      cameraPreset: preset.id,
                      focalLength: preset.focal,
                      depthOfField: preset.dof,
                    },
                  }),
                )
              }
              className={`px-2 py-1.5 text-xs rounded border transition-colors ${
                segment.cameraPreset === preset.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'hover:bg-muted'
              }`}
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Split layout */}
      <div>
        <span className="text-xs font-medium mb-2 block">{t('cameraPresets.layoutTitle')}</span>
        <div className="grid grid-cols-5 gap-1.5">
          {LAYOUTS.map((layout) => (
            <button
              key={layout.id}
              onClick={() =>
                dispatch(
                  updateCamera({ segmentId: selectedId, camera: { splitLayout: layout.id } }),
                )
              }
              className={`px-2 py-1.5 text-xs rounded border transition-colors ${
                segment.splitLayout === layout.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'hover:bg-muted'
              }`}
            >
              {t(layout.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Focal length slider */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">{t('cameraPresets.focalLength')}</span>
          <span>{segment.focalLength ?? 50}mm</span>
        </div>
        <input
          type="range"
          min={12}
          max={200}
          step={1}
          value={segment.focalLength ?? 50}
          onChange={(e) =>
            dispatch(
              updateCamera({
                segmentId: selectedId,
                camera: { focalLength: Number(e.target.value) },
              }),
            )
          }
          className="w-full h-1.5 rounded-full appearance-none bg-muted [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
      </div>

      {/* Depth of field slider */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">{t('cameraPresets.depthOfField')}</span>
          <span>{((segment.depthOfField ?? 0.5) * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={(segment.depthOfField ?? 0.5) * 100}
          onChange={(e) =>
            dispatch(
              updateCamera({
                segmentId: selectedId,
                camera: { depthOfField: Number(e.target.value) / 100 },
              }),
            )
          }
          className="w-full h-1.5 rounded-full appearance-none bg-muted [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
      </div>
    </div>
  );
}
