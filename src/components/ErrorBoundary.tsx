import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error in ErrorBoundary:", error, errorInfo);
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex h-full min-h-[400px] w-full flex-col items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
                    <div className="mb-4 rounded-full bg-red-100 p-3">
                        <AlertTriangle className="h-8 w-8 text-red-600" />
                    </div>
                    <h2 className="mb-2 text-lg font-semibold text-red-900">
                        抱歉，工作台遇到了一些问题
                    </h2>
                    <p className="mb-6 max-w-md text-sm text-red-700">
                        {this.state.error?.message || "UI 渲染时发生未知错误，您可以尝试重新加载恢复工作状态。"}
                    </p>
                    <button
                        onClick={this.handleReset}
                        className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                    >
                        <RefreshCw className="h-4 w-4" />
                        重新加载
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
