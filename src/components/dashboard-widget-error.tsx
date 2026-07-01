'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DashboardWidgetErrorProps {
  children: ReactNode;
  /** Widget label shown in fallback UI */
  label?: string;
  /** Optional custom fallback content */
  fallback?: ReactNode;
}

interface DashboardWidgetErrorState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Widget-level error boundary. Catches rendering errors inside a single
 * dashboard widget so a broken card does not cascade to siblings or the
 * surrounding layout.
 */
export class DashboardWidgetError extends Component<
  DashboardWidgetErrorProps,
  DashboardWidgetErrorState
> {
  constructor(props: DashboardWidgetErrorProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): DashboardWidgetErrorState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[DashboardWidgetError:${this.props.label ?? 'unnamed'}]`,
      error,
      errorInfo,
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex flex-col items-center justify-center min-h-[120px] gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-muted-foreground">
            {this.props.label
              ? `${this.props.label} unavailable`
              : 'Widget unavailable'}
          </p>
          <Button
            onClick={this.handleRetry}
            variant="ghost"
            size="sm"
            className="mt-1"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
