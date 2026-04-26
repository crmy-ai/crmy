// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
  /** Optional label shown in the error card, e.g. "step" or "action" */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React error boundary for workflow / sequence editor sub-sections.
 *
 * A crash in a nested component (ActionCard, StepFields, VarField, etc.)
 * is caught here and rendered as an inline error card instead of collapsing
 * the entire editor dialog.  All changes outside the broken section remain
 * intact and the user can click "Retry" to attempt recovery.
 */
export class EditorErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console so developers can diagnose without losing context
    console.error('[EditorErrorBoundary] Caught render error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.label ?? 'section';

    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-4 flex items-start gap-3 text-sm">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-destructive mb-0.5">
            Something went wrong in this {label}
          </p>
          <p className="text-muted-foreground text-xs mb-2">
            Your other changes are safe. Click Retry to attempt recovery.
          </p>
          {this.state.error?.message && (
            <p className="text-xs font-mono text-destructive/80 truncate">
              {this.state.error.message}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-destructive hover:bg-destructive/10 h-7 px-2"
          onClick={this.handleRetry}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }
}
