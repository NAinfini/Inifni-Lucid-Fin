import { Component, type ErrorInfo, type ReactNode } from 'react';

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
      return (
        <div style={{ padding: 16, color: '#ef4444', fontSize: 13 }}>
          <p style={{ fontWeight: 600 }}>{this.props.name ?? 'App'} encountered an error</p>
          <p style={{ opacity: 0.7, fontSize: 12 }}>{this.state.error.message}</p>
          <button
            onClick={this.reset}
            style={{
              marginTop: 8,
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
              border: '1px solid currentColor',
              borderRadius: 4,
              background: 'transparent',
              color: 'inherit',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
