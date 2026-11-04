import type { ExpressColumn, ExpressComparison, ExpressVerdict, FixedPr, FixKind } from '@mb-factory/core';
import { EXPRESS_BASELINE, EXPRESS_DAYS, formatRunTime } from '@mb-factory/core';
import type { ReactNode } from 'react';

import { consoleTimeZone } from '@/lib/projects';

const VERDICTS: Record<NonNullable<ExpressVerdict>, { label: string; className: string }> = {
  down: { label: 'Down', className: 'text-ok' },
  not_down: { label: 'Not down', className: 'text-warn' },
  no_worse: { label: 'No worse', className: 'text-ok' },
  worse: { label: 'Worse', className: 'text-warn' }
};

const FIX_WORDS: Record<FixKind, string> = {
  revert: 'reverted by',
  same_issue: 'followed by a second PR,',
  named: 'fixed by'
};

const time = (ms: number | null): string => (ms === null ? '–' : formatRunTime(ms));

const day = (at: Date): string =>
  at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: consoleTimeZone() });

const Delta = ({ text, better }: { text: string; better: boolean }) => (
  <span className={`ml-1 text-xs ${better ? 'text-ok' : 'text-warn'}`}>{text}</span>
);

// Against the baseline: a percentage for times, a difference for taps.
const percentDelta = (value: number | null, base: number | null): ReactNode => {
  if (value === null || base === null || base === 0) {
    return null;
  }
  const change = Math.round((value / base - 1) * 100);
  return <Delta text={`${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change)}%`} better={change < 0} />;
};

const countDelta = (value: number | null, base: number | null): ReactNode => {
  if (value === null || base === null) {
    return null;
  }
  const change = value - base;
  return <Delta text={`${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change)}`} better={change < 0} />;
};

const verdictTag = (verdict: ExpressVerdict): ReactNode =>
  verdict === 'no_worse' || verdict === 'worse' ? (
    <Delta text={VERDICTS[verdict].label.toLowerCase()} better={verdict === 'no_worse'} />
  ) : null;

const share = (part: number, whole: number): string =>
  whole === 0 ? '–' : part === 0 ? `0 of ${whole}` : `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`;

const sentryCount = ({ sentryIssues, prs }: ExpressColumn): string =>
  sentryIssues === null
    ? 'unread'
    : prs === 0 || sentryIssues === 0
      ? String(sentryIssues)
      : `${sentryIssues} (${(sentryIssues / prs).toFixed(2)} a PR)`;

type Row = { label: string; cell: (column: ExpressColumn, baseline: ExpressColumn) => ReactNode };

const ROWS = (verdicts: ExpressComparison['verdicts']): Row[] => [
  { label: 'PRs merged', cell: ({ prs }) => prs },
  {
    label: 'Median cycle time',
    cell: (column, baseline) => (
      <>
        {time(column.medianCycleMs)}
        {column.key !== 'baseline' && percentDelta(column.medianCycleMs, baseline.medianCycleMs)}
      </>
    )
  },
  {
    label: 'Median waiting on you',
    cell: (column, baseline) => (
      <>
        {time(column.medianHumanWaitMs)}
        {column.key !== 'baseline' && percentDelta(column.medianHumanWaitMs, baseline.medianHumanWaitMs)}
      </>
    )
  },
  {
    label: 'Median taps per PR',
    cell: (column, baseline) => (
      <>
        {column.medianTaps ?? '–'}
        {column.key !== 'baseline' && countDelta(column.medianTaps, baseline.medianTaps)}
      </>
    )
  },
  {
    label: 'Merged by itself',
    cell: ({ mergedByItself, prs }) =>
      mergedByItself === 0 ? <span className="text-foreground/70">none</span> : `${mergedByItself} of ${prs}`
  },
  {
    label: `Fixed or reverted within 7 days`,
    cell: (column) => (
      <>
        {share(column.fixed.length, column.prs)}
        {column.key === 'express' && verdictTag(verdicts.fixes)}
      </>
    )
  },
  {
    label: 'New Sentry issues within 30 min of a merge',
    cell: (column) => (
      <>
        {sentryCount(column)}
        {column.key === 'express' && verdictTag(verdicts.sentry)}
      </>
    )
  }
];

const Chip = ({ verdict, label }: { verdict: ExpressVerdict; label: string }) => (
  <span className="border-foreground/20 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm">
    {verdict ? (
      <span className={`font-semibold ${VERDICTS[verdict].className}`}>{VERDICTS[verdict].label}</span>
    ) : (
      <span className="text-foreground/70 font-semibold">Not yet</span>
    )}
    {label}
  </span>
);

const FixLine = ({ pr }: { pr: FixedPr }) => (
  <li>
    <a href={pr.url} className="font-medium underline-offset-2 hover:underline">
      {pr.identifier}
    </a>{' '}
    {pr.title}, merged{pr.autoMerged ? ' by itself' : ''} {day(pr.mergedAt)},{' '}
    {pr.fixes.map(({ byPrNumber, byMergedAt, kind }, index) => (
      <span key={byPrNumber}>
        {index > 0 && '; '}
        {FIX_WORDS[kind]}{' '}
        <a
          href={`https://github.com/${pr.repository}/pull/${byPrNumber}`}
          className="underline-offset-2 hover:underline"
        >
          PR #{byPrNumber}
        </a>{' '}
        {day(byMergedAt) === day(pr.mergedAt) ? 'the same day' : `on ${day(byMergedAt)}`}
      </span>
    ))}
  </li>
);

export const ExpressPanel = ({ express, days }: { express: ExpressComparison; days: number }) => {
  const { baseline, verdicts } = express;
  const columns = [
    { column: baseline, name: 'Baseline', range: EXPRESS_BASELINE.label },
    { column: express.express, name: 'Express', range: `last ${days} days` },
    { column: express.careful, name: 'Careful', range: `last ${days} days` }
  ];
  const fixed = columns.flatMap(({ column }) => column.fixed);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Express against the baseline</h2>
        <p className="text-foreground/70 text-sm">
          PRs merged in the range, by track, beside Phase 4’s baseline ({EXPRESS_BASELINE.label}, frozen). Phase 5 ends
          after two weeks of express with cycle time and taps down, and fixes and Sentry issues no worse.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip verdict={verdicts.cycle} label="Cycle time" />
        <Chip verdict={verdicts.taps} label="Taps per PR" />
        <Chip verdict={verdicts.fixes} label="Fixes or reverts" />
        <Chip verdict={verdicts.sentry} label="New Sentry issues" />
        <span className="text-foreground/70 px-2.5 py-1 text-sm">
          Express for {express.expressDays} of {EXPRESS_DAYS} days
        </span>
      </div>

      <div className="border-foreground/15 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-foreground/70 text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-normal">
                <span className="sr-only">Measure</span>
              </th>
              {columns.map(({ name, range }) => (
                <th key={name} scope="col" className="px-3 py-2 text-right font-normal">
                  {name}
                  <br />
                  <span className="text-xs">{range}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {ROWS(verdicts).map(({ label, cell }) => (
              <tr key={label} className="border-foreground/10 border-t">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {label}
                </th>
                {columns.map(({ column, name }) => (
                  <td key={name} className="px-3 py-2 text-right whitespace-nowrap">
                    {cell(column, baseline)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fixed.length > 0 && (
        <details className="text-sm">
          <summary className="text-foreground/70 cursor-pointer">Fixes and reverts</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {fixed.map((pr) => (
              <FixLine key={pr.identifier} pr={pr} />
            ))}
          </ul>
        </details>
      )}

      <p className="text-foreground/70 text-xs">
        Taps: questions answered, gates left, typed replies, findings fixed by choice, re-runs, a merge by you and
        Revert. A fix or revert counts when a later PR reverts the merge, is a second PR for the same issue, or names it
        after “fix”, “regression from” or “broke”. Sentry: issues first seen within 30 minutes of each merge, resolved
        or not.
      </p>
    </section>
  );
};
