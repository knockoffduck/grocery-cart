"use client";

// Route-level error boundary. Catches errors in nested route segments
// (CartView, Scanner, etc.) and lets the user retry without reloading
// the whole app. The full error is logged to the console; only a
// human-readable message is shown to the user.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log full error details server-side / dev-tools only. Not rendered.
  console.error('route error:', error);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
      <p className="text-sm text-aldi-text/70 mb-4 max-w-md">
        The app hit an error rendering this view. Your cart is saved on the
        server — try again, or pull to refresh if the problem persists.
      </p>
      {error.digest && (
        <p className="text-xs text-aldi-text/50 mb-4 font-mono">
          ref: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="px-5 py-2.5 bg-aldi-blue text-white rounded-full font-semibold touch-manipulation"
      >
        Try again
      </button>
    </div>
  );
}
