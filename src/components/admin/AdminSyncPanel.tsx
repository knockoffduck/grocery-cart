'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { triggerAldiSync } from '@/app/actions/admin';
import type { SyncProgress } from '@/lib/sync-runner';

type Status = SyncProgress;

type SyncStatusResponse = {
  progress: Status;
  counts: {
    aldi_products: number;
    ean_aldi_matches: number;
    manual_matches: number;
  };
  aldiLastSync: string | null;
  matchLastRun: string | null;
  matchLastPreserved: string | null;
};

const POLL_MS = 2000;

const fmtTime = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

export function AdminSyncPanel({ initial }: { initial: Status }) {
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  const [triggerPending, startTrigger] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/admin/sync/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as SyncStatusResponse;
      setData(body);
      setError(null);
      if (body.progress.status === 'running') {
        timerRef.current = setTimeout(fetchStatus, POLL_MS);
      }
    } catch (e) {
      setError((e as Error).message);
      timerRef.current = setTimeout(fetchStatus, POLL_MS);
    }
  };

  useEffect(() => {
    fetchStatus();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTrigger = () => {
    setMessage(null);
    setError(null);
    startTrigger(async () => {
      try {
        const res = await triggerAldiSync();
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setMessage(res.message);
        // Kick off polling
        if (timerRef.current) clearTimeout(timerRef.current);
        fetchStatus();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const progress = data?.progress ?? initial;
  const counts = data?.counts;
  const isRunning = progress.status === 'running';
  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-aldi-border rounded-2xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-aldi-text">Catalogue</h2>
        <p className="text-sm text-aldi-text-muted mt-1">
          Pull the latest products from the Aldi store API. The match pass runs
          automatically after the pull and never overrides manual matches.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <Stat label="Aldi products" value={counts?.aldi_products ?? '—'} />
          <Stat label="Auto matches" value={counts?.ean_aldi_matches ?? '—'} />
          <Stat label="Manual matches" value={counts?.manual_matches ?? '—'} />
        </div>

        <div className="mt-4 text-xs text-aldi-text-muted">
          Last sync: <span className="text-aldi-text font-medium">{fmtTime(data?.aldiLastSync ?? null)}</span>
          {' · '}
          Last match: <span className="text-aldi-text font-medium">{fmtTime(data?.matchLastRun ?? null)}</span>
          {data?.matchLastPreserved ? (
            <span className="ml-1">({data.matchLastPreserved} manual preserved)</span>
          ) : null}
        </div>

        <button
          onClick={onTrigger}
          disabled={triggerPending || isRunning}
          className="mt-5 w-full bg-aldi-blue text-white rounded-lg py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {isRunning
            ? 'Sync in progress…'
            : triggerPending
            ? 'Starting…'
            : 'Fetch new Aldi items'}
        </button>

        {isRunning && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-aldi-text-muted">
              <span>
                {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%)
              </span>
              <span>Started {fmtTime(progress.startedAt)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-aldi-bg overflow-hidden">
              <div
                className="h-full bg-aldi-blue transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {progress.status === 'done' && !isRunning && (
          <p className="mt-4 text-xs text-green-700">
            Last sync finished at {fmtTime(progress.completedAt)}.
          </p>
        )}
        {progress.status === 'error' && !isRunning && (
          <p className="mt-4 text-xs text-red-600">
            Last sync failed: {progress.error ?? 'unknown error'}.
          </p>
        )}

        {message && (
          <p className="mt-3 text-xs text-aldi-text-muted">{message}</p>
        )}
        {error && (
          <p className="mt-3 text-xs text-red-600">{error}</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-aldi-bg rounded-xl py-3 px-2">
      <div className="text-2xl font-black text-aldi-blue tabular-nums">
        {value === '—' ? '—' : Number(value).toLocaleString()}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-aldi-text-muted mt-1">
        {label}
      </div>
    </div>
  );
}
