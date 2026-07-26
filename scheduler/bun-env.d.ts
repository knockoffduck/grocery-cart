// Minimal Bun runtime type declarations for the scheduler service.
// The full @types/bun package is used in Docker (oven/bun image includes it).
// This stub satisfies tsc on dev machines where Bun isn't installed.

declare namespace Bun {
  function serve(options: {
    port?: number;
    hostname?: string;
    fetch(req: Request): Response | Promise<Response>;
  }): { stop(): void; port: number };
}
