import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
}

export interface ToastInput {
  title: string;
  message?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

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
        return {
          payload: {
            id: createToastId(),
            title: input.title,
            message: input.message,
            variant,
            durationMs: input.durationMs ?? DEFAULT_DURATION_BY_VARIANT[variant],
            createdAt: Date.now(),
          } satisfies ToastItem,
        };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.items = state.items.filter((toast) => toast.id !== action.payload);
    },
    clearToasts(state) {
      state.items = [];
    },
  },
});

export const { enqueueToast, dismissToast, clearToasts } = toastSlice.actions;
