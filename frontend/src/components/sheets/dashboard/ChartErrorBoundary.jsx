/**
 * ChartErrorBoundary — catches render errors in chart compilation.
 *
 * If a chart fails to render (bad data shape, missing keys, etc.),
 * this boundary catches the error and shows a fallback message.
 * It supports a configurable retry count (default: 3).
 */

import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('[ChartErrorBoundary]', error?.message, errorInfo);
  }

  handleRetry = () => {
    const maxRetries = this.props.maxRetries ?? 3;
    if (this.state.retryCount < maxRetries) {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        retryCount: prev.retryCount + 1,
      }));
    } else if (this.props.onMaxRetriesExceeded) {
      this.props.onMaxRetriesExceeded(this.state.error);
    }
  };

  render() {
    const maxRetries = this.props.maxRetries ?? 3;

    if (this.state.hasError) {
      const canRetry = this.state.retryCount < maxRetries;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="text-sm text-gray-600 font-medium">Chart rendering failed</p>
          <p className="text-xs text-gray-400 max-w-xs">
            {this.state.error?.message || 'Unknown error'}
          </p>
          {canRetry ? (
            <button
              onClick={this.handleRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry ({this.state.retryCount + 1}/{maxRetries})
            </button>
          ) : (
            <p className="text-xs text-red-400">
              Max retries reached. Try regenerating the dashboard.
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
