"use client";

// Global error boundary. If a React render or effect throws, this catches
// it and shows the error in plain text so the user can see what went wrong
// instead of staring at a frozen UI that "looks fine" but won't respond.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
        <pre style={{
          background: "#fff",
          padding: "0.75rem",
          borderRadius: "0.5rem",
          fontSize: "0.8rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          margin: "0 0 1rem",
          border: "1px solid #fecaca",
        }}>
          {error.message}
          {error.digest && `\n\ndigest: ${error.digest}`}
          {error.stack && `\n\n${error.stack.split("\n").slice(0, 6).join("\n")}`}
        </pre>
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
