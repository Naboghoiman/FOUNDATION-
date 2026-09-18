import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('DJ IMAN Audio Engine Caught Error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#07090c] text-white flex flex-col items-center justify-center p-4 select-none">
          <div className="max-w-lg w-full bg-[#0d1117] border-2 border-red-500/80 rounded-2xl p-6 shadow-[0_0_40px_rgba(239,68,68,0.3)] flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-red-950/80 border border-red-500 flex items-center justify-center text-red-400 mb-4 shadow-[0_0_15px_rgba(239,68,68,0.5)]">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <h1 className="text-xl font-mono font-black tracking-wider text-red-400 uppercase mb-2">
              DJ CONSOLE RECOVERY
            </h1>

            <p className="text-sm text-neutral-300 mb-4">
              An unexpected audio or rendering error was caught. The hardware failsafe prevented a crash.
            </p>

            <div className="w-full bg-[#040608] border border-neutral-800 rounded-lg p-3 text-left font-mono text-xs text-red-300 overflow-x-auto max-h-36 mb-5">
              <div className="font-bold">{this.state.error?.name || 'Error'}: {this.state.error?.message}</div>
              {this.state.errorInfo?.componentStack && (
                <pre className="text-[10px] text-neutral-400 mt-2 whitespace-pre-wrap">
                  {this.state.errorInfo.componentStack.slice(0, 300)}...
                </pre>
              )}
            </div>

            <button
              onClick={this.handleReset}
              className="px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-sm tracking-wider flex items-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.5)] cursor-pointer transition-all hover:scale-105"
            >
              <RefreshCw className="w-4 h-4" />
              <span>RESTART CONSOLE</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
