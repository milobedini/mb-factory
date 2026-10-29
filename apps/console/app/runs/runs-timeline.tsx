import type { RunTrigger, Stage } from '@mb-factory/core';
import { formatReleaseAt, formatRunTime, isOpenRun, linearStatusFor, runTiming } from '@mb-factory/core';

import { AutoRefresh } from '@/app/auto-refresh';
import { consoleTimeZone, findProject } from '@/lib/projects';
import type { JobRuns, RunRow, WorkItemRuns } from '@/lib/runs-view';
import { loadRunsView } from '@/lib/runs-view';

import { cancelRunAction, rerunAction } from './actions';

const TRIGGER_COPY: Record<RunTrigger, string> = {
  delegated: 'delegated',
  prompted: 'a reply',
  spec_approved: 'spec approved',
  design_approved: 'design approved',
  delivered: 'PR delivered',
  review_findings: 'review findings',
  ci_failed: 'CI failed',
  conflict: 'merge conflict',
  rerun: 'resumed after the limit',
  console: 're-run from the console',
  answered: 'answers',
  scheduled: 'scheduled',
  asked: 'a question',
  accepted: 'accepted without a size'
};

const STAGE_STYLES: Partial<Record<Stage, string>> = {
  spec_review: 'text-warn',
  design_review: 'text-warn',
  awaiting_merge: 'text-warn',
  done: 'text-ok',
  canceled: 'text-foreground/60'
};

const statusOf = ({ status, outcome }: RunRow): { label: string; className: string } => {
  if (status === 'queued') {
    return { label: 'Queued', className: 'text-foreground/70' };
  }
  if (status === 'dispatched' || status === 'running') {
    return { label: status === 'running' ? 'Running' : 'Starting', className: 'text-warn' };
  }
  if (status === 'limit_hit') {
    return { label: 'Hit the usage limit', className: 'text-warn' };
  }
  if (status === 'canceled') {
    return { label: 'Canceled', className: 'text-foreground/60' };
  }
  if (outcome === 'done') {
    return { label: 'Done', className: 'text-ok' };
  }
  if (outcome === 'needs_input') {
    return { label: 'Needs input', className: 'text-warn' };
  }
  if (outcome === 'failed' || outcome === 'blocked') {
    return { label: outcome === 'failed' ? 'Failed' : 'Blocked', className: 'text-danger' };
  }
  return { label: outcome === 'declined' ? 'Declined' : 'Stopped', className: 'text-foreground/70' };
};

const usd = (cost: number): string => `$${cost.toFixed(2)}`;

const SecondaryButton = ({ label }: { label: string }) => (
  <button type="submit" className="border-foreground/20 hover:bg-foreground/5 rounded-md border px-2.5 py-1 text-xs">
    {label}
  </button>
);

const RunItem = ({ run, rerunnable, now }: { run: RunRow; rerunnable: boolean; now: Date }) => {
  const status = statusOf(run);
  const { waitedMs, ranMs } = runTiming(run, now);
  const facts = [
    run.model,
    `queued ${formatRunTime(waitedMs)}`,
    ranMs === null ? undefined : `ran ${formatRunTime(ranMs)}`,
    run.numTurns === null ? undefined : `${run.numTurns} turns`,
    run.costUsd === null ? undefined : usd(run.costUsd)
  ].filter((fact) => fact !== undefined);
  const open = isOpenRun(run.status);
  return (
    <li className="border-foreground/20 relative flex flex-col gap-1 border-l pb-4 pl-4 last:pb-0">
      <span className="bg-foreground/40 absolute top-1.5 -left-1 size-2 rounded-full" aria-hidden="true" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-medium">{run.agent}</span>{' '}
          <span className="text-foreground/70 text-sm">
            · {TRIGGER_COPY[run.trigger]} · {formatReleaseAt(run.createdAt, now, consoleTimeZone())}
          </span>{' '}
          <span className={`text-sm ${status.className}`}>{status.label}</span>
        </p>
        <div className="flex items-center gap-2">
          {run.actionsRunUrl && (
            <a href={run.actionsRunUrl} className="text-sm underline-offset-2 hover:underline">
              Run log
            </a>
          )}
          {open && (
            <form action={cancelRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <SecondaryButton label="Cancel" />
            </form>
          )}
          {rerunnable && (
            <form action={rerunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <SecondaryButton label="Re-run" />
            </form>
          )}
        </div>
      </div>
      <p className="text-foreground/70 text-sm tabular-nums">{facts.join(' · ')}</p>
      {run.summary && <p className="text-sm">{run.summary}</p>}
    </li>
  );
};

const WorkItemSection = ({ item, now }: { item: WorkItemRuns; now: Date }) => {
  const { workItem, prUrl, runs, totals, rerunnableId } = item;
  const project = findProject(workItem.project);
  const stageLabel = project ? linearStatusFor(project, workItem.stage) : workItem.stage;
  const facts = [
    `${totals.runs} ${totals.runs === 1 ? 'run' : 'runs'}`,
    totals.costUsd === null ? undefined : usd(totals.costUsd),
    totals.durationMs > 0 ? `${formatRunTime(totals.durationMs)} of agent time` : undefined,
    workItem.reviewRounds > 0 ? `review round ${workItem.reviewRounds}` : undefined,
    workItem.humanPushes > 0
      ? `${workItem.humanPushes} human ${workItem.humanPushes === 1 ? 'push' : 'pushes'}`
      : undefined
  ].filter((fact) => fact !== undefined);
  return (
    <section className="border-foreground/15 flex flex-col gap-4 rounded-lg border p-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">
            <a href={workItem.issueUrl} className="underline-offset-2 hover:underline">
              {workItem.issueIdentifier}
            </a>
            {workItem.title ? ` ${workItem.title}` : ''}
          </h2>
          <span className={`text-sm ${STAGE_STYLES[workItem.stage] ?? ''}`}>{stageLabel}</span>
        </div>
        <p className="text-foreground/70 text-sm tabular-nums">
          {facts.join(' · ')}
          {prUrl && (
            <>
              {' · '}
              <a href={prUrl} className="underline-offset-2 hover:underline">
                PR #{workItem.prNumber}
              </a>
            </>
          )}
        </p>
      </header>
      {runs.length === 0 ? (
        <p className="text-foreground/70 text-sm">No runs yet.</p>
      ) : (
        <ol className="ml-1 flex flex-col">
          {runs.map((run) => (
            <RunItem key={run.id} run={run} rerunnable={run.id === rerunnableId} now={now} />
          ))}
        </ol>
      )}
    </section>
  );
};

const JobSection = ({ job, now }: { job: JobRuns; now: Date }) => (
  <section className="border-foreground/15 flex flex-col gap-4 rounded-lg border p-4">
    <header>
      <h2 className="font-medium">{job.title}</h2>
      <p className="text-foreground/70 text-sm">Latest runs, newest first.</p>
    </header>
    {job.runs.length === 0 ? (
      <p className="text-foreground/70 text-sm">It hasn’t run yet.</p>
    ) : (
      <ol className="ml-1 flex flex-col">
        {job.runs.map((run) => (
          <RunItem key={run.id} run={run} rerunnable={false} now={now} />
        ))}
      </ol>
    )}
  </section>
);

export const RunsTimeline = async () => {
  const view = await loadRunsView();
  const working = [...view.workItems, ...view.jobs].some(({ runs }) => runs.some(({ status }) => isOpenRun(status)));
  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={working} />
      {view.workItems.length === 0 ? (
        <p className="text-foreground/70">Nothing has run yet. Delegate an issue to the factory in Linear.</p>
      ) : (
        view.workItems.map((item) => <WorkItemSection key={item.workItem.id} item={item} now={view.now} />)
      )}
      {view.jobs.map((job) => (
        <JobSection key={job.key} job={job} now={view.now} />
      ))}
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
