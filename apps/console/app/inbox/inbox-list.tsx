import type { ChecksState, InboxEntry, ReadyIssue } from '@mb-factory/core';
import { formatDuration, formatReleaseAt } from '@mb-factory/core';

import { AutoRefresh } from '@/app/auto-refresh';
import type { InboxItem, ProjectReady } from '@/lib/inbox-view';
import { loadInboxView } from '@/lib/inbox-view';
import { consoleTimeZone } from '@/lib/projects';

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

// What it's waiting for, and the link that settles it.
const describe = (entry: InboxEntry): { title: string; action: string | null } => {
  switch (entry.kind) {
    case 'questions':
      return {
        title:
          entry.answered > 0
            ? `${plural(entry.open, 'question')} left (${entry.answered} answered)`
            : `${plural(entry.open, 'question')} to answer`,
        action: null
      };
    case 'spec_review':
      return { title: 'Spec waiting for approval', action: 'Read the spec' };
    case 'awaiting_merge':
      return { title: 'PR waiting for your review and merge', action: 'Review the PR' };
    case 'run_ended':
      return { title: `The ${entry.agent ?? ''} run ended without finishing`, action: 'Run log' };
    case 'reply_needed':
      return { title: `The ${entry.agent ?? ''} run is waiting for a reply`, action: null };
  }
};

const CHECKS_COPY: Record<ChecksState, { label: string; className: string } | null> = {
  passing: { label: 'CI passing', className: 'text-ok' },
  failing: { label: 'CI failing', className: 'text-danger' },
  pending: { label: 'CI running', className: 'text-foreground/70' },
  none: null
};

const InboxRow = ({ item, now }: { item: InboxItem; now: Date }) => {
  const { workItem, entry, actionUrl, threadUrl, checks, conflictsWith, summary } = item;
  const { title, action } = describe(entry);
  const checksCopy = checks ? CHECKS_COPY[checks] : null;
  const prUrl = workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;
  const links = [
    actionUrl && action ? { href: actionUrl, label: action } : undefined,
    threadUrl ? { href: threadUrl, label: 'Slack thread' } : undefined,
    { href: workItem.issueUrl, label: 'Linear' },
    prUrl && entry.kind !== 'awaiting_merge' ? { href: prUrl, label: `PR #${workItem.prNumber}` } : undefined
  ].filter((link) => link !== undefined);
  return (
    <li className="border-foreground/15 flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">
          {workItem.issueIdentifier}
          {workItem.title ? ` ${workItem.title}` : ''}
        </h2>
        <span className="text-foreground/70 text-sm tabular-nums">
          waiting {formatDuration(now.getTime() - entry.since.getTime())} · since{' '}
          {formatReleaseAt(entry.since, now, consoleTimeZone())}
        </span>
      </div>
      <p className="text-warn text-sm">
        {title}
        {checksCopy && <span className={`ml-2 ${checksCopy.className}`}>· {checksCopy.label}</span>}
        {conflictsWith && <span className="text-danger ml-2">· Conflicts with {conflictsWith}</span>}
      </p>
      {summary && <p className="text-foreground/80 text-sm">{summary}</p>}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {links.map(({ href, label }) => (
          <a key={label} href={href} className="underline-offset-2 hover:underline">
            {label}
          </a>
        ))}
      </p>
    </li>
  );
};

const ReadyRow = ({ issue }: { issue: ReadyIssue }) => (
  <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
    <a href={issue.url} className="underline-offset-2 hover:underline">
      <span className="font-medium">{issue.identifier}</span> {issue.title}
    </a>
    <span className="text-foreground/70 text-sm">
      {issue.project} · {issue.size}
      {issue.waitingOn.length > 0 ? ` · waiting on ${issue.waitingOn.join(', ')}` : ''}
    </span>
  </li>
);

const ReadyGroup = ({
  title,
  note,
  empty,
  issues
}: {
  title: string;
  note: string;
  empty: string;
  issues: ReadyIssue[];
}) => (
  <section className="flex flex-col gap-1">
    <h2 className="text-lg font-semibold">{title}</h2>
    <p className="text-foreground/70 text-sm">{note}</p>
    {issues.length === 0 ? (
      <p className="text-foreground/70 py-2 text-sm">{empty}</p>
    ) : (
      <ol className="divide-foreground/15 flex flex-col divide-y">
        {issues.map((issue) => (
          <ReadyRow key={issue.identifier} issue={issue} />
        ))}
      </ol>
    )}
  </section>
);

// What to delegate next, from Linear: the factory never delegates by itself.
const ReadySections = ({ ready }: { ready: ProjectReady[] }) => {
  const unread = ready.filter(({ list }) => list === null).map(({ project }) => project);
  const readyNow = ready.flatMap(({ list }) => list?.ready ?? []);
  const yours = ready.flatMap(({ list }) => list?.yours ?? []);
  return (
    <div className="border-foreground/15 flex flex-col gap-6 border-t pt-6">
      {unread.length > 0 && <p className="text-warn text-sm">Couldn’t read Linear for {unread.join(', ')}.</p>}
      <ReadyGroup
        title="Ready to delegate"
        note="Unstarted issues in open projects, unassigned, with nothing left blocking them; in your project order, then by priority."
        empty="Nothing is ready to delegate."
        issues={readyNow}
      />
      <ReadyGroup
        title="Yours"
        note="Assigned to a person, so they’re never offered to the factory."
        empty="Nothing is assigned to anyone."
        issues={yours}
      />
    </div>
  );
};

export const InboxList = async () => {
  const view = await loadInboxView();
  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={view.working || view.items.length > 0} />
      {view.items.length === 0 ? (
        <p className="text-foreground/70">
          Nothing is waiting on you.{view.working ? ' The factory is working on something; this page keeps up.' : ''}
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {view.items.map((item) => (
            <InboxRow key={item.workItem.id} item={item} now={view.now} />
          ))}
        </ol>
      )}
      <ReadySections ready={view.ready} />
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
