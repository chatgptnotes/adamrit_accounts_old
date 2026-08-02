import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunkReload";

// Boundary for the routed content area only. The app-level boundary in App.tsx
// still exists as the last line of defence, but it replaces the entire shell —
// sidebar included — and only offers a full reload. This one keeps the sidebar
// usable and resets itself when the route changes, so a crash in one tab no
// longer reads as "the whole app is broken".
class Boundary extends React.Component<
  { children: React.ReactNode; onGoBack: () => void },
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Stale-chunk errors self-heal with a one-time reload; only log the rest.
    if (reloadOnceForChunkError(error)) return;
    console.error('Route Error:', error, errorInfo);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (isChunkLoadError(error)) {
      return (
        <div className="flex items-center justify-center p-8 text-gray-600">
          Updating to the latest version…
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center max-w-2xl w-full">
          <h1 className="text-xl font-bold text-red-600 mb-2">This page failed to load</h1>
          <p className="text-gray-600 mb-4">
            The rest of the app is still working — pick another item from the sidebar, or try again.
          </p>
          {/* The exact failure, on screen — a screenshot of this page is a bug report. */}
          <pre className="mb-4 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-3 text-left text-xs text-red-800">
            {error.message}
            {'\n'}
            {(error.stack || '').split('\n').slice(1, 4).join('\n')}
          </pre>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => this.setState({ error: undefined })}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                this.setState({ error: undefined });
                this.props.onGoBack();
              }}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              Go Back
            </button>
          </div>
          {import.meta.env.DEV && (
            <pre style={{ textAlign: 'left', overflow: 'auto', maxHeight: 300, background: '#fee2e2', padding: 12, fontSize: 12, marginTop: 16, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {error.message}{'\n\n'}{error.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

// Keyed on pathname so navigating away from a crashed page remounts a clean
// boundary — without the key, React keeps the errored state forever.
export const RouteErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <Boundary key={pathname} onGoBack={() => navigate(-1)}>
      {children}
    </Boundary>
  );
};

export default RouteErrorBoundary;
