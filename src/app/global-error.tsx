"use client";

// Global error boundary. If a React render or effect throws, this catches
// it and shows a sanitized message + the opaque error digest (a server-side
// correlation ID). The full error is logged to the browser console (dev tools
// only) so it doesn't leak to other users via the rendered DOM.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log full error details to the console for devs. Not rendered to the DOM.
  console.error('global error:', error);

  return (
    <html>
      <body style={{ fontFamily: "-apple-system, sans-serif", padding: "1rem", background: "#fee2e2", color: "#7f1d1d" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
          Something broke
        </h1>
        <p style={{ margin: "0 0 1rem" }}>
          The app hit an error and the UI is no longer responsive. You can try
          to recover, or pull-to-refresh in Safari to reload the page.
        </p>
        {error.digest && (
          <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "#991b1b" }}>
            Reference: <code style={{ background: "#fff", padding: "0.1rem 0.4rem", borderRadius: "0.25rem" }}>{error.digest}</code>
          </p>
        )}
        <button
          onClick={reset}
          style={{
            padding: "0.75rem 1.5rem",
            background: "#0019a5",
            color: "white",
            border: "none",
            borderRadius: "9999px",
            fontSize: "1rem",
            fontWeight: 600,
            touchAction: "manipulation",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
