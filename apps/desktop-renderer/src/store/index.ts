import { configureStore } from '@reduxjs/toolkit';
import { projectSlice } from './slices/project.js';
import { seriesSlice } from './slices/series.js';
import { scriptSlice } from './slices/script.js';
import { charactersSlice } from './slices/characters.js';
import { equipmentSlice } from './slices/equipment.js';
import { storyboardSlice } from './slices/storyboard.js';
import { orchestrationSlice } from './slices/orchestration.js';
import { timelineSlice } from './slices/timeline.js';
import { audioSlice } from './slices/audio.js';
import { jobsSlice } from './slices/jobs.js';
import { workflowsSlice } from './slices/workflows.js';
import { assetsSlice } from './slices/assets.js';
import { aiSlice } from './slices/ai.js';
import { uiSlice } from './slices/ui.js';
import { settingsSlice } from './slices/settings.js';
import { toastSlice } from './slices/toast.js';
import { loggerSlice } from './slices/logger.js';
import { canvasReducer } from './slices/canvas.js';
import { presetsSlice } from './slices/presets.js';
import { commanderSlice } from './slices/commander.js';
import { promptTemplatesSlice } from './slices/promptTemplates.js';
import { locationsSlice } from './slices/locations.js';
import { shotTemplatesSlice } from './slices/shotTemplates.js';
import { listenerMiddleware } from './middleware/listener.js';
import { ipcMiddleware } from './middleware/ipc.js';
import { persistMiddleware } from './middleware/persist.js';
import { undoMiddleware } from './middleware/undo.js';

export const store = configureStore({
  reducer: {
    project: projectSlice.reducer,
    series: seriesSlice.reducer,
    script: scriptSlice.reducer,
    characters: charactersSlice.reducer,
    equipment: equipmentSlice.reducer,
    storyboard: storyboardSlice.reducer,
    orchestration: orchestrationSlice.reducer,
    timeline: timelineSlice.reducer,
    audio: audioSlice.reducer,
    jobs: jobsSlice.reducer,
    workflows: workflowsSlice.reducer,
    assets: assetsSlice.reducer,
    ai: aiSlice.reducer,
    ui: uiSlice.reducer,
    settings: settingsSlice.reducer,
    toast: toastSlice.reducer,
    logger: loggerSlice.reducer,
    canvas: canvasReducer,
    presets: presetsSlice.reducer,
    commander: commanderSlice.reducer,
    promptTemplates: promptTemplatesSlice.reducer,
    locations: locationsSlice.reducer,
    shotTemplates: shotTemplatesSlice.reducer,
  },
  middleware: (getDefault) =>
    getDefault()
      .prepend(listenerMiddleware.middleware)
      .concat(ipcMiddleware, persistMiddleware, undoMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Expose store for main-process Commander AI provider tools
(window as unknown as Record<string, unknown>).__REDUX_STORE__ = store;
