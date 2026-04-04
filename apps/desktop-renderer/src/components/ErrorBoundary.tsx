import React, { Component, type ReactNode } from 'react';
import { t } from '../i18n.js';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Send to main process for structured logging
    const api = (window as unknown as Record<string, unknown>).electronAPI as
      | { log?: (level: string, data: Record<string, unknown>) => void }
      | undefined;
    api?.log?.('error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      timestamp: Date.now(),
    });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className="flex flex-col items-center justify-center h-screen bg-background text-foreground p-8"
          role="alert"
        >
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-xl font-semibold">{t('error.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message ?? t('error.unknown')}
            </p>
            <details className="text-left text-xs bg-muted p-3 rounded max-h-40 overflow-auto">
              <summary className="cursor-pointer text-muted-foreground mb-1">
                {t('error.details')}
              </summary>
              <pre className="whitespace-pre-wrap break-all">{this.state.error?.stack}</pre>
            </details>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t('action.retry')}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm rounded bg-secondary text-secondary-foreground hover:bg-muted"
              >
                {t('error.reload')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
