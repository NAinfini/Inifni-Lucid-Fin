import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n.js';

interface ErrorBoundaryProps {
  children: ReactNode;
  name?: string;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    console.error(`[ErrorBoundary:${this.props.name ?? 'App'}]`, error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      const label = this.props.name ?? 'App';
      const safeMessage =
        this.state.error.message.length > 200
          ? this.state.error.message.slice(0, 200) + '…'
          : this.state.error.message;
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <svg
              className="h-6 w-6 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
              />
            </svg>
          </div>
          <p className="text-sm font-semibold text-foreground">
            {label} — {t('errorBoundary.title')}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">{safeMessage}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={this.reset}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('errorBoundary.retry')}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t('errorBoundary.reload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
