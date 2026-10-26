import type { HoldReason, UsageSummary, WindowSummary } from '@mb-factory/core';
import { formatDuration, formatReleaseAt, USAGE_HOLD_REASONS } from '@mb-factory/core';

import { consoleTimeZone } from '@/lib/projects';
import type { HeldRun, UsageView } from '@/lib/usage-view';
import { loadUsageView } from '@/lib/usage-view';

import { allowAction, pauseAction, resumeAction } from './actions';
import { RefreshButton } from './refresh-button';

const WINDOW_NAMES: Record<WindowSummary['window'], string> = { fiveHour: '5-hour window', sevenDay: 'Weekly window' };

const STATE_STYLES: Record<UsageSummary['state'], { label: string; className: string }> = {
  open: { label: 'Open', className: 'text-ok' },
  throttled: { label: 'Throttled', className: 'text-warn' },
  paused: { label: 'Paused', className: 'text-danger' }
};

const REASON_COPY: Record<HoldReason, string> = {
  concurrency: 'Run cap reached',
  work_item_busy: 'Another run on this issue',
  manual_pause: 'Paused from the console',
  five_hour_throttle: '5-hour throttle',
  five_hour_pause: '5-hour pause',
  weekly_pacing: 'Ahead of weekly pace',
  weekly_pause: 'Weekly pause'
};

const STATE_EXPLANATION: Record<UsageSummary['state'], string> = {
  open: 'New work dispatches normally.',
  throttled: 'Only work already in flight and urgent items run, on cheaper models.',
  paused: 'Nothing new dispatches until the window resets.'
};

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

const barColour = ({ utilisation, throttleAt, pauseAt, paceLimit }: WindowSummary): string => {
  if (utilisation >= pauseAt) {
    return 'bg-danger';
  }
  if ((throttleAt !== null && utilisation >= throttleAt) || (paceLimit !== null && utilisation > paceLimit)) {
    return 'bg-warn';
  }
  return 'bg-ok';
};

const Marker = ({ at, label }: { at: number; label: string }) => (
  <div
    className="border-foreground/60 absolute top-0 h-full border-l border-dashed"
    style={{ left: `${Math.min(at, 1) * 100}%` }}
    title={`${label} at ${percent(at)}`}
  />
);

const WindowGauge = ({ summary, now }: { summary: WindowSummary; now: Date }) => {
  const markers = [
    summary.throttleAt === null ? undefined : { at: summary.throttleAt, label: 'Throttle' },
    { at: summary.pauseAt, label: 'Pause' },
    summary.paceLimit === null ? undefined : { at: summary.paceLimit, label: 'Weekly pace' }
  ].filter((marker) => marker !== undefined);
  return (
    <section className="border-foreground/15 flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{WINDOW_NAMES[summary.window]}</h3>
        <span className="text-2xl font-semibold tabular-nums">{percent(summary.utilisation)}</span>
      </div>
      <meter
        className="sr-only"
        aria-label={WINDOW_NAMES[summary.window]}
        min={0}
        max={1}
        value={summary.utilisation}
        high={summary.throttleAt ?? summary.paceLimit ?? summary.pauseAt}
      />
      <div className="bg-foreground/10 relative h-3 overflow-hidden rounded-full" aria-hidden="true">
        <div className={`h-full ${barColour(summary)}`} style={{ width: `${summary.utilisation * 100}%` }} />
        {markers.map((marker) => (
          <Marker key={marker.label} {...marker} />
        ))}
      </div>
      <dl className="text-foreground/70 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt>Resets</dt>
        <dd>
          {summary.resetsAt
            ? `in ${formatDuration(summary.resetsAt.getTime() - now.getTime())} (${formatReleaseAt(summary.resetsAt, now, consoleTimeZone())})`
            : summary.reset
              ? 'Reset since the last reading'
              : 'Unknown'}
        </dd>
        <dt>Reading</dt>
        <dd className={summary.stale ? 'text-warn' : undefined}>
          {summary.takenAt
            ? `${formatDuration(now.getTime() - summary.takenAt.getTime())} old, from ${summary.source}${summary.stale ? ' (stale)' : ''}`
            : 'None yet'}
        </dd>
        <dt>Limits</dt>
        <dd>{markers.map(({ label, at }) => `${label} ${percent(at)}`).join(' · ')}</dd>
      </dl>
    </section>
  );
};

const PauseControl = ({ pause, now }: Pick<UsageView, 'pause' | 'now'>) =>
  pause ? (
    <form action={resumeAction} className="flex flex-wrap items-center gap-3">
      <p className="text-danger text-sm">
        Paused by {pause.pausedBy} {formatDuration(now.getTime() - pause.pausedAt.getTime())} ago. Nothing new
        dispatches.
      </p>
      <button type="submit" className="bg-foreground text-background rounded-md px-3 py-1.5 text-sm">
        Resume
      </button>
    </form>
  ) : (
    <form action={pauseAction}>
      <button
        type="submit"
        className="border-foreground/20 hover:bg-foreground/5 rounded-md border px-3 py-1.5 text-sm"
      >
        Pause the factory
      </button>
    </form>
  );

const HeldRow = ({ run, now }: { run: HeldRun; now: Date }) => (
  <li className="border-foreground/10 flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0">
    <div className="flex flex-col gap-0.5">
      <p>
        {run.issueUrl ? (
          <a href={run.issueUrl} className="font-medium underline-offset-2 hover:underline">
            {run.issueIdentifier}
          </a>
        ) : (
          <span className="font-medium">{run.job} job</span>
        )}{' '}
        <span className="text-foreground/70 text-sm">
          {run.agent} · {run.trigger} · {run.priority.replace('_', '-')}
        </span>
      </p>
      <p className="text-foreground/70 text-sm">
        {REASON_COPY[run.reason]}, held {formatDuration(now.getTime() - run.heldAt.getTime())}
        {run.releaseAt ? `, until ${formatReleaseAt(run.releaseAt, now, consoleTimeZone())}` : ''}
        {run.usageOverrideBy ? ` · allowed by ${run.usageOverrideBy}` : ''}
      </p>
    </div>
    {USAGE_HOLD_REASONS.includes(run.reason) && !run.usageOverrideBy && (
      <form action={allowAction}>
        <input type="hidden" name="runId" value={run.runId} />
        <button
          type="submit"
          className="border-foreground/20 hover:bg-foreground/5 rounded-md border px-3 py-1.5 text-sm"
        >
          Allow once
        </button>
      </form>
    )}
  </li>
);

export const UsageDashboard = async () => {
  const view = await loadUsageView();
  const { now } = view;
  return (
    <div className="flex flex-col gap-8">
      {view.projects.map(({ name, alias, maxRuns, summary }) => {
        const state = view.pause ? STATE_STYLES.paused : STATE_STYLES[summary.state];
        return (
          <section key={name} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-medium">
                  {alias}: <span className={state.className}>{state.label}</span>
                </h2>
                <p className="text-foreground/70 text-sm">
                  {view.pause ? 'Paused from the console.' : STATE_EXPLANATION[summary.state]} {view.activeRuns} of{' '}
                  {maxRuns} runs going.
                </p>
              </div>
              <RefreshButton />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {summary.windows.map((window) => (
                <WindowGauge key={window.window} summary={window} now={now} />
              ))}
            </div>
          </section>
        );
      })}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Queue</h2>
          <PauseControl pause={view.pause} now={now} />
        </div>
        {view.held.length === 0 ? (
          <p className="text-foreground/70 text-sm">Nothing is waiting.</p>
        ) : (
          <ul className="border-foreground/15 rounded-lg border px-4">
            {view.held.map((run) => (
              <HeldRow key={run.runId} run={run} now={now} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Recent readings</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-foreground/70">
              <tr>
                <th className="py-1 pr-4 font-normal">Taken</th>
                <th className="py-1 pr-4 font-normal">Window</th>
                <th className="py-1 pr-4 font-normal">Used</th>
                <th className="py-1 font-normal">Source</th>
              </tr>
            </thead>
            <tbody>
              {view.recent.map((reading) => (
                <tr key={reading.id} className="border-foreground/10 border-t">
                  <td className="py-1 pr-4">{formatDuration(now.getTime() - reading.takenAt.getTime())} ago</td>
                  <td className="py-1 pr-4">{WINDOW_NAMES[reading.window]}</td>
                  <td className="py-1 pr-4">{percent(reading.utilisation)}</td>
                  <td className="py-1">{reading.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="border-foreground/15 text-foreground/70 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
        <span>Signed in as {view.user.login}</span>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="underline-offset-2 hover:underline">
            Sign out
          </button>
        </form>
      </footer>
    </div>
  );
};
