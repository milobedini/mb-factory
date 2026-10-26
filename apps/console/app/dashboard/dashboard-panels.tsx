import type { BreakdownRow, Dashboard, Stage } from '@mb-factory/core';
import { DASHBOARD_RANGES, formatRunTime, readDashboardRange } from '@mb-factory/core';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { DashboardView } from '@/lib/dashboard-view';
import { loadDashboardView } from '@/lib/dashboard-view';

const STAGE_NAMES: Record<Stage, string> = {
  researching: 'Researching',
  spec: 'Spec',
  spec_review: 'Spec review',
  building: 'Building',
  in_review: 'In review',
  awaiting_merge: 'Awaiting merge',
  done: 'Done',
  canceled: 'Canceled'
};

const dollars = (usd: number | null): string => (usd === null ? '–' : `$${usd.toFixed(2)}`);

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

// British English's compact form writes millions as "m", which reads like minutes beside the run times.
const tokens = (count: number | null): string => (count === null ? '–' : compact.format(count).toUpperCase());

const time = (ms: number | null): string => (ms === null ? '–' : formatRunTime(ms));

const share = (part: number, whole: number): string => (whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`);

const dayLabel = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const Tile = ({ label, value, detail }: { label: string; value: string; detail: string }) => (
  <section className="border-foreground/15 flex flex-col gap-1 rounded-lg border p-4">
    <h3 className="text-foreground/70 text-sm">{label}</h3>
    <p className="text-2xl font-semibold tabular-nums">{value}</p>
    <p className="text-foreground/70 text-sm">{detail}</p>
  </section>
);

const Section = ({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">{title}</h2>
      {detail && <p className="text-foreground/70 text-sm">{detail}</p>}
    </div>
    {children}
  </section>
);

const Table = ({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) =>
  rows.length === 0 ? (
    <p className="text-foreground/70 text-sm">{empty}</p>
  ) : (
    <div className="border-foreground/15 overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="text-foreground/70 text-left">
          <tr>
            {head.map((cell, index) => (
              <th key={cell} className={`px-3 py-2 font-normal ${index > 0 ? 'text-right' : ''}`}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // Rows have no identity beyond their position in a table built once per render.
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows
            <tr key={rowIndex} className="border-foreground/10 border-t">
              {row.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static cells
                <td key={index} className={`px-3 py-2 ${index > 0 ? 'text-right tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

const SERIES = [
  { key: 'opened', label: 'Opened', className: 'bg-series-1' },
  { key: 'merged', label: 'Merged', className: 'bg-series-2' }
] as const;

// PRs opened and merged each day: a bar pair per day, the day's counts on hover and in the table below.
const DailyChart = ({ daily }: Pick<Dashboard, 'daily'>) => {
  const top = Math.max(1, ...daily.flatMap(({ opened, merged }) => [opened, merged]));
  const labelEvery = Math.ceil(daily.length / 7);
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-foreground/70 flex gap-4 text-sm">
        {SERIES.map(({ key, label, className }) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-sm ${className}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </figcaption>
      <div className="flex gap-2" aria-hidden="true">
        <div className="text-foreground/60 flex h-36 flex-col justify-between text-right text-xs tabular-nums">
          <span>{top}</span>
          <span>0</span>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <div className="border-foreground/10 relative flex h-36 items-end border-y">
            {daily.map(({ day, opened, merged }) => (
              <div
                key={day}
                title={`${dayLabel(day)}: ${opened} opened, ${merged} merged`}
                className="hover:bg-foreground/5 flex h-full flex-1 items-end justify-center gap-[2px] px-[1px]"
              >
                {SERIES.map(({ key, className }) => {
                  const count = key === 'opened' ? opened : merged;
                  return (
                    <div
                      key={key}
                      className={`w-1/2 max-w-3 rounded-t ${className}`}
                      style={{ height: `${(count / top) * 100}%` }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="text-foreground/60 flex text-xs">
            {daily.map(({ day }, index) => (
              <span key={day} className="flex-1 text-center whitespace-nowrap">
                {(daily.length - 1 - index) % labelEvery === 0 ? dayLabel(day) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <details className="text-sm">
        <summary className="text-foreground/70 cursor-pointer">As a table</summary>
        <div className="mt-2">
          <Table
            head={['Day', 'Opened', 'Merged']}
            rows={daily.map(({ day, opened, merged }) => [dayLabel(day), opened, merged])}
            empty="No days in the range."
          />
        </div>
      </details>
    </figure>
  );
};

const BreakdownTable = ({ title, rows }: { title: string; rows: BreakdownRow[] }) => (
  <div className="flex flex-col gap-2">
    <h3 className="text-sm font-medium">{title}</h3>
    <Table
      head={[title, 'Runs', 'Cost']}
      rows={rows.map(({ key, runs, costUsd }) => [key.replaceAll('_', ' '), runs, dollars(costUsd)])}
      empty="No runs."
    />
  </div>
);

const RangePicker = ({ days }: Pick<DashboardView, 'days'>) => (
  <nav aria-label="Date range" className="flex flex-wrap items-center gap-2 text-sm">
    <span className="text-foreground/70">Last</span>
    {DASHBOARD_RANGES.map((range) => (
      <Link
        key={range}
        href={`/dashboard?days=${range}`}
        aria-current={range === days ? 'page' : undefined}
        className={`rounded-md border px-3 py-1 ${
          range === days
            ? 'bg-foreground text-background border-foreground'
            : 'border-foreground/20 hover:bg-foreground/5'
        }`}
      >
        {range} days
      </Link>
    ))}
  </nav>
);

export const DashboardPanels = async ({ searchParams }: { searchParams: PageProps<'/dashboard'>['searchParams'] }) => {
  const { days: requested } = await searchParams;
  const { days, dashboard } = await loadDashboardView(readDashboardRange(requested));
  const { prs, autonomy, cycle, review } = dashboard;
  return (
    <div className="flex flex-col gap-10">
      <RangePicker days={days} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Autonomy"
          value={share(autonomy.autonomous, autonomy.merged)}
          detail={`${autonomy.autonomous} of ${autonomy.merged} merged PRs had no human push`}
        />
        <Tile
          label="Median cycle time"
          value={time(cycle.medianMs)}
          detail={`Delegation to merge; ${time(cycle.medianHumanWaitMs)} of it waiting on you`}
        />
        <Tile
          label="First-pass acceptance"
          value={share(review.firstPass, review.reviewed)}
          detail={`${review.firstPass} of ${review.reviewed} PRs accepted at their first review`}
        />
        <Tile
          label="Median cost per PR"
          value={dollars(dashboard.medianCostPerPrUsd)}
          detail={`Over the ${prs.merged} merged PRs, every run included`}
        />
      </div>

      <Section
        title="PRs opened and merged"
        detail={`${prs.opened} opened, ${prs.merged} merged, ${prs.closedUnmerged} closed without merging.`}
      >
        <DailyChart daily={dashboard.daily} />
      </Section>

      <Section
        title="Where the time goes"
        detail={`Median per merged PR: ${time(cycle.medianFactoryMs)} of the factory’s time and ${time(cycle.medianHumanWaitMs)} waiting on you.`}
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Time in each stage</h3>
            <Table
              head={['Stage', 'Median', 'PRs']}
              rows={cycle.stages.map(({ stage, medianMs, items }) => [STAGE_NAMES[stage], time(medianMs), items])}
              empty="No merged PRs in the range."
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Waiting on you</h3>
            <Table
              head={['Wait', 'Median', 'PRs']}
              rows={cycle.waits.map(({ label, medianMs, items }) => [label, time(medianMs), items])}
              empty="No waits in the range."
            />
          </div>
        </div>
      </Section>

      <Section
        title="Usage per PR by size"
        detail="Merged PRs by the estimate triage gave them. Run time is each run’s start to finish in Actions."
      >
        <Table
          head={['Size', 'PRs', 'Median cost', 'Total cost', 'Median tokens', 'Median run time']}
          rows={dashboard.bySize.map((row) => [
            row.size,
            row.prs,
            dollars(row.medianCostUsd),
            dollars(row.totalCostUsd),
            tokens(row.medianTokens),
            time(row.medianRunMs)
          ])}
          empty="No merged PRs in the range."
        />
      </Section>

      <Section title="Most expensive work items" detail="By the cost of their runs in the range.">
        <Table
          head={['Work item', 'Runs', 'Cost']}
          rows={dashboard.expensive.map((item) => [
            <span key="item">
              <a href={item.url} className="font-medium underline-offset-2 hover:underline">
                {item.identifier}
              </a>{' '}
              <span className="text-foreground/70">
                {item.title}
                {item.origin === 'dependabot' ? ' (Dependabot)' : ''}
              </span>
            </span>,
            item.runs,
            dollars(item.costUsd)
          ])}
          empty="No runs in the range."
        />
      </Section>

      <Section
        title="Review loop"
        detail={`${review.reviewed} PRs first reviewed in the range; ${review.revisions} revisions requested in all, at most ${review.mostRevisions} on one PR.`}
      />

      <Section title="Runs" detail="Every run started in the range, the scheduled jobs included.">
        <div className="grid gap-6 sm:grid-cols-2">
          {dashboard.breakdown.map(({ title, rows }) => (
            <BreakdownTable key={title} title={title} rows={rows} />
          ))}
        </div>
      </Section>
    </div>
  );
};
