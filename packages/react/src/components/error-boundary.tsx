'use client';

import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import type {
  TraceXErrorBoundaryProps,
  TraceXErrorBoundaryState,
  FallbackRender,
} from '../types';
import { TraceXContext } from '../context/tracex-context';
import { TraceX } from '../index';

/**
 * React Error Boundary capturing component tree crashes, extracting componentStack,
 * and dispatching crash telemetry to TraceX with mechanism 'react.error_boundary'.
 */
export class TraceXErrorBoundary extends Component<
  TraceXErrorBoundaryProps,
  TraceXErrorBoundaryState
> {
  static override contextType = TraceXContext;
  declare context: React.ContextType<typeof TraceXContext>;

  override state: TraceXErrorBoundaryState = {
    hasError: false,
    error: null,
    componentStack: null,
    eventId: undefined,
  };

  static getDerivedStateFromError(error: unknown): Partial<TraceXErrorBoundaryState> {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    return {
      hasError: true,
      error: normalizedError,
    };
  }

  override componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const componentStack = errorInfo?.componentStack || null;
    const client = this.props.client || this.context?.client || TraceX.getClient();

    let eventId: string | undefined;
    if (client) {
      try {
        eventId = client.captureException(normalizedError, {
          mechanism: 'react.error_boundary',
          componentStack,
        });
      } catch (err) {
        if (client.getOptions().debug) {
          console.warn('[TraceX] Error in TraceXErrorBoundary client.captureException:', err);
        }
      }
    }

    this.setState({ componentStack, eventId, error: normalizedError });

    try {
      this.props.onError?.(normalizedError, { componentStack, eventId });
    } catch (err) {
      console.warn('[TraceX] Error in TraceXErrorBoundary onError callback:', err);
    }
  }

  override componentDidUpdate(prevProps: TraceXErrorBoundaryProps): void {
    const { hasError } = this.state;
    const { resetKeys } = this.props;

    if (hasError && resetKeys !== undefined) {
      const prevResetKeys = prevProps.resetKeys;
      if (this.haveResetKeysChanged(prevResetKeys, resetKeys)) {
        this.reset();
      }
    }
  }

  private haveResetKeysChanged(
    prevResetKeys: readonly unknown[] | undefined,
    currentResetKeys: readonly unknown[]
  ): boolean {
    if (!prevResetKeys) {
      return true;
    }
    if (prevResetKeys.length !== currentResetKeys.length) {
      return true;
    }
    for (let i = 0; i < currentResetKeys.length; i++) {
      if (!Object.is(prevResetKeys[i], currentResetKeys[i])) {
        return true;
      }
    }
    return false;
  }

  public reset = (): void => {
    try {
      this.props.onReset?.();
    } catch (err) {
      console.warn('[TraceX] Error in TraceXErrorBoundary onReset callback:', err);
    }
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
      eventId: undefined,
    });
  };

  override render(): ReactNode {
    const { hasError, error, componentStack, eventId } = this.state;
    const { fallback, children } = this.props;

    if (hasError) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      if (typeof fallback === 'function') {
        return (fallback as FallbackRender)({
          error: normalizedError,
          componentStack,
          eventId,
          reset: this.reset,
        });
      }
      if (fallback !== undefined) {
        return fallback;
      }
      return null;
    }

    return children;
  }
}

const REACT_STATICS: Record<string, boolean> = {
  displayName: true,
  name: true,
  length: true,
  prototype: true,
  caller: true,
  callee: true,
  arguments: true,
  arity: true,
  $$typeof: true,
  render: true,
  defaultProps: true,
  propTypes: true,
};

/**
 * Higher-Order Component (HOC) wrapping a React component in TraceXErrorBoundary.
 * Forwards refs, guards against nullish components, and hoists non-React static properties.
 */
export function withTraceXErrorBoundary<P extends object>(
  ComponentToWrap: React.ComponentType<P>,
  errorBoundaryProps?: TraceXErrorBoundaryProps
): React.ComponentType<P> {
  if (!ComponentToWrap) {
    return ComponentToWrap;
  }

  const WrappedComponent = React.forwardRef<any, P>((props, ref) => (
    <TraceXErrorBoundary {...errorBoundaryProps}>
      <ComponentToWrap {...(props as any)} ref={ref} />
    </TraceXErrorBoundary>
  ));

  const componentName =
    ComponentToWrap.displayName || ComponentToWrap.name || 'Component';
  WrappedComponent.displayName = `withTraceXErrorBoundary(${componentName})`;

  // Hoist static properties
  for (const prop of Object.getOwnPropertyNames(ComponentToWrap)) {
    if (!REACT_STATICS[prop]) {
      try {
        (WrappedComponent as any)[prop] = (ComponentToWrap as any)[prop];
      } catch {}
    }
  }

  return WrappedComponent as unknown as React.ComponentType<P>;
}
