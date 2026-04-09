import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
  actionLabel?: string;
}

export interface ToastInput {
  title: string;
  message?: string;
  variant?: ToastVariant;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Registry for toast action callbacks. Keyed by toast id.
 * Stored outside Redux to avoid non-serializable value warnings.
 */
export const toastActionRegistry = new Map<string, () => void>();

export interface ToastState {
  items: ToastItem[];
}

const DEFAULT_DURATION_BY_VARIANT: Record<ToastVariant, number> = {
  info: 3500,
  success: 3200,
  warning: 5000,
  error: 6500,
};

function createToastId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const toastSlice = createSlice({
  name: 'toast',
  initialState: { items: [] } as ToastState,
  reducers: {
    enqueueToast: {
      reducer(state, action: PayloadAction<ToastItem>) {
        state.items.push(action.payload);
      },
      prepare(input: ToastInput) {
        const variant = input.variant ?? 'info';
        const id = createToastId();
        if (input.onAction) {
          toastActionRegistry.set(id, input.onAction);
        }
        return {
          payload: {
            id,
            title: input.title,
            message: input.message,
            variant,
            durationMs: input.durationMs ?? DEFAULT_DURATION_BY_VARIANT[variant],
            createdAt: Date.now(),
            actionLabel: input.actionLabel,
          } satisfies ToastItem,
        };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      toastActionRegistry.delete(action.payload);
      state.items = state.items.filter((toast) => toast.id !== action.payload);
    },
    clearToasts(state) {
      toastActionRegistry.clear();
      state.items = [];
    },
  },
});

export const { enqueueToast, dismissToast, clearToasts } = toastSlice.actions;
