import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { clearToasts, dismissToast, enqueueToast, type ToastInput } from '../store/slices/toast.js';

type VariantInput = Omit<ToastInput, 'variant'>;

export function useToast() {
  const dispatch = useDispatch();

  const showToast = useCallback(
    (input: ToastInput) => {
      dispatch(enqueueToast(input));
    },
    [dispatch],
  );

  const info = useCallback(
    (input: VariantInput) => {
      dispatch(enqueueToast({ ...input, variant: 'info' }));
    },
    [dispatch],
  );

  const success = useCallback(
    (input: VariantInput) => {
      dispatch(enqueueToast({ ...input, variant: 'success' }));
    },
    [dispatch],
  );

  const warning = useCallback(
    (input: VariantInput) => {
      dispatch(enqueueToast({ ...input, variant: 'warning' }));
    },
    [dispatch],
  );

  const error = useCallback(
    (input: VariantInput) => {
      dispatch(enqueueToast({ ...input, variant: 'error' }));
    },
    [dispatch],
  );

  const dismiss = useCallback(
    (id: string) => {
      dispatch(dismissToast(id));
    },
    [dispatch],
  );

  const clear = useCallback(() => {
    dispatch(clearToasts());
  }, [dispatch]);

  return { showToast, info, success, warning, error, dismiss, clear };
}
