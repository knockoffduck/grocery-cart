// =============================================================================
// Aldi Cart — Scheduler Service
// =============================================================================
//
// Standalone Bun service that periodically runs the full sync pipeline:
//   1. Aldi catalogue sync (src/lib/sync-runner.ts)
//   2. Open Food Facts brand sync (scripts/sync-off.ts)
//   3. OFF → Aldi match pass (src/lib/match-runner.ts)
//
// Configuration (env vars):
//   SCHEDULE_INTERVAL_HOURS  — hours between runs (default: 48 = 2 days)
//   SCHEDULE_PORT            — HTTP port for status/trigger API (default: 3001)
//   RUN_ON_START             — run pipeline immediately on boot (default: false)
//   POCKETBASE_ADMIN_EMAIL   — required
//   POCKETBASE_ADMIN_PASSWORD — required
//   POCKETBASE_URL           — optional, defaults to https://pb.dvcklab.com
//   PROXY_URL                — optional, Webshare proxy for OFF sync
//   ALDI_SERVICE_POINT       — optional, defaults to G452
//
// HTTP API:
//   GET  /health             — liveness probe
//   GET  /status             — scheduler state + last run info
//   POST /trigger            — manually trigger a pipeline run
//   POST /trigger?step=aldi  — trigger only the Aldi sync step
//   POST /trigger?step=off   — trigger only the OFF sync step
//   POST /trigger?step=match — trigger only the match step
// =============================================================================

import { runAldiSync, getSyncProgress } from '../packages/api/src/lib/sync-runner';
import { runMatch } from '../packages/api/src/lib/match-runner';
import { syncOffByBrand } from '../scripts/sync-off';
import { setMeta, getMeta } from '../packages/api/src/lib/pb';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INTERVAL_HOURS = parseFloat(process.env.SCHEDULE_INTERVAL_HOURS || '48');
const PORT = parseInt(process.env.SCHEDULE_PORT || '3001', 10);
const RUN_ON_START = process.env.RUN_ON_START === 'true';

const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type RunStatus = 'idle' | 'running' | 'done' | 'error';

type PipelineResult = {
  step: string;
  success: boolean;
  elapsedMs: number;
  detail: string;
};

type RunRecord = {
  startedAt: string;
  completedAt: string | null;
  status: RunStatus;
  steps: PipelineResult[];
  error: string | null;
};

let currentRun: RunRecord | null = null;
let lastRun: RunRecord | null = null;
let nextRunAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let runCount = 0;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const logLines: string[] = [];
const MAX_LOG_LINES = 200;

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines.shift();
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function runStep(
  name: string,
  fn: (log: (msg: string) => void) => Promise<{ detail: string }>,
): Promise<PipelineResult> {
  const start = Date.now();
  log(`[pipeline] starting step: ${name}`);
  try {
    const { detail } = await fn(log);
    const elapsedMs = Date.now() - start;
    log(`[pipeline] step ${name} done in ${(elapsedMs / 1000).toFixed(1)}s — ${detail}`);
    return { step: name, success: true, elapsedMs, detail };
  } catch (e: any) {
    const elapsedMs = Date.now() - start;
    const msg = e?.message ?? String(e);
    log(`[pipeline] step ${name} FAILED after ${(elapsedMs / 1000).toFixed(1)}s: ${msg}`);
    return { step: name, success: false, elapsedMs, detail: msg };
  }
}

async function runPipeline(steps?: string[]): Promise<void> {
  if (currentRun?.status === 'running') {
    log('[pipeline] already running, skipping trigger');
    return;
  }

  const run: RunRecord = {
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    steps: [],
    error: null,
  };
  currentRun = run;
  runCount++;

  await setMeta('scheduler_status', 'running');
  await setMeta('scheduler_started_at', run.startedAt);

  const allSteps = steps ?? ['aldi', 'off', 'match'];
  log(`[pipeline] === run #${runCount} starting (steps: ${allSteps.join(', ')}) ===`);

  for (const step of allSteps) {
    // Abort remaining steps if a critical one fails
    if (run.steps.some((s) => !s.success && s.step === 'aldi') && step !== 'aldi') {
      log(`[pipeline] skipping ${step} because aldi sync failed`);
      run.steps.push({ step, success: false, elapsedMs: 0, detail: 'skipped (aldi failed)' });
      continue;
    }

    let result: PipelineResult;
    switch (step) {
      case 'aldi':
        result = await runStep('aldi', async (l) => {
          const r = await runAldiSync({ runMatchAfter: false, log: l });
          return { detail: `${r.total} products in ${(r.elapsedMs / 1000).toFixed(1)}s` };
        });
        break;
      case 'off':
        result = await runStep('off', async (l) => {
          const r = await syncOffByBrand({ log: l });
          return { detail: `${r.products} products from ${r.brands} brands` };
        });
        break;
      case 'match':
        result = await runStep('match', async (l) => {
          const r = await runMatch({ log: l });
          return { detail: `${r.matches} matches (${r.exact} exact, ${r.fuzzy} fuzzy)` };
        });
        break;
      default:
        result = { step, success: false, elapsedMs: 0, detail: `unknown step: ${step}` };
    }
    run.steps.push(result);
  }

  run.completedAt = new Date().toISOString();
  const allOk = run.steps.every((s) => s.success);
  run.status = allOk ? 'done' : 'error';
  if (!allOk) {
    run.error = run.steps.filter((s) => !s.success).map((s) => `${s.step}: ${s.detail}`).join('; ');
  }

  lastRun = run;
  currentRun = null;

  await setMeta('scheduler_status', run.status);
  await setMeta('scheduler_completed_at', run.completedAt);
  await setMeta('scheduler_last_error', run.error ?? '');
  await setMeta('scheduler_run_count', String(runCount));

  log(`[pipeline] === run #${runCount} finished: ${run.status} ===`);
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

function scheduleNext() {
  nextRunAt = Date.now() + INTERVAL_MS;
  log(`[scheduler] next run at ${new Date(nextRunAt).toISOString()} (every ${INTERVAL_HOURS}h)`);
  timer = setTimeout(async () => {
    await runPipeline();
    scheduleNext();
  }, INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  fetch(req: Request) {
    const url = new URL(req.url);

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, uptime: process.uptime() });
    }

    // GET /status
    if (req.method === 'GET' && url.pathname === '/status') {
      return Response.json({
        scheduler: {
          intervalHours: INTERVAL_HOURS,
          nextRunAt: nextRunAt ? new Date(nextRunAt).toISOString() : null,
          runCount,
        },
        currentRun: currentRun
          ? { startedAt: currentRun.startedAt, steps: currentRun.steps }
          : null,
        lastRun: lastRun
          ? {
              startedAt: lastRun.startedAt,
              completedAt: lastRun.completedAt,
              status: lastRun.status,
              steps: lastRun.steps,
              error: lastRun.error,
            }
          : null,
        logs: logLines.slice(-50),
      });
    }

    // GET /logs
    if (req.method === 'GET' && url.pathname === '/logs') {
      const n = parseInt(url.searchParams.get('n') || '100', 10);
      return Response.json({ logs: logLines.slice(-n) });
    }

    // POST /trigger
    if (req.method === 'POST' && url.pathname === '/trigger') {
      if (currentRun?.status === 'running') {
        return Response.json({ error: 'pipeline already running' }, { status: 409 });
      }
      const step = url.searchParams.get('step');
      const steps = step ? [step] : undefined;
      // Fire and forget — don't block the HTTP response
      runPipeline(steps).catch((e) => log(`[trigger] unhandled: ${e.message}`));
      return Response.json({
        ok: true,
        message: `pipeline triggered${step ? ` (step: ${step})` : ' (full)'}`,
      });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

log(`[scheduler] Aldi Cart scheduler started on port ${PORT}`);
log(`[scheduler] interval: ${INTERVAL_HOURS}h | run_on_start: ${RUN_ON_START}`);

if (RUN_ON_START) {
  log('[scheduler] running pipeline on start...');
  runPipeline()
    .then(() => scheduleNext())
    .catch((e) => {
      log(`[scheduler] initial run failed: ${e.message}`);
      scheduleNext();
    });
} else {
  scheduleNext();
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('[scheduler] SIGTERM received, shutting down');
  if (timer) clearTimeout(timer);
  server.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('[scheduler] SIGINT received, shutting down');
  if (timer) clearTimeout(timer);
  server.stop();
  process.exit(0);
});
