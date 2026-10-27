import { sizeLabel } from './dashboard';

// An issue out of Triage that nobody has started, as Linear reports it, in one of the team's projects or none.
export type CandidateIssue = {
  // Linear's ID, to delegate the issue by.
  id: string;
  identifier: string;
  title: string;
  url: string;
  // Linear's: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
  priority: number;
  estimate: number | null;
  assignee: string | null;
  delegated: boolean;
  project: { name: string; url: string | null; sortOrder: number; statusType: string } | null;
  milestone: string | null;
  // Every issue that blocks this one, with whether it's finished.
  blockers: { identifier: string; finished: boolean }[];
};

export type ReadyIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  project: string | null;
  projectUrl: string | null;
  milestone: string | null;
  size: string;
  assignee: string | null;
  // Every issue that blocks this one, finished or not.
  blockedBy: string[];
  // Blockers not yet finished; only an issue that's someone's can have any.
  waitingOn: string[];
};

export type ReadyList = { ready: ReadyIssue[]; yours: ReadyIssue[]; needsSize: ReadyIssue[] };

const CLOSED_PROJECT = ['completed', 'canceled'];

const issueNumber = (identifier: string): number => Number(identifier.split('-').at(-1));

// Urgent first and no priority last, as Linear sorts them.
const priorityRank = (priority: number): number => (priority === 0 ? 5 : priority);

// The projects in the order the team keeps them, issues with no project last.
const byProject = (a: CandidateIssue, b: CandidateIssue): number =>
  a.project && b.project ? a.project.sortOrder - b.project.sortOrder : Number(!a.project) - Number(!b.project);

// By project, then by priority, then oldest first.
const byOrder = (a: CandidateIssue, b: CandidateIssue): number =>
  byProject(a, b) ||
  priorityRank(a.priority) - priorityRank(b.priority) ||
  issueNumber(a.identifier) - issueNumber(b.identifier);

const toReady = (issue: CandidateIssue): ReadyIssue => ({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  url: issue.url,
  project: issue.project?.name ?? null,
  projectUrl: issue.project?.url ?? null,
  milestone: issue.milestone,
  size: sizeLabel(issue.estimate),
  assignee: issue.assignee,
  blockedBy: issue.blockers.map(({ identifier }) => identifier),
  waitingOn: issue.blockers.filter(({ finished }) => !finished).map(({ identifier }) => identifier)
});

// What can be delegated now: accepted out of Triage, in an open project or none, sized, not delegated or assigned,
// nothing left blocking it. An issue assigned to a person is theirs to do, so it's listed apart and never offered to the
// factory. An unassigned issue with no size isn't ready, blocked or not: it's listed as needing one, so it isn't lost.
export const readyList = (issues: CandidateIssue[]): ReadyList => {
  const open = issues
    .filter(({ delegated, project }) => !delegated && !(project && CLOSED_PROJECT.includes(project.statusType)))
    .toSorted(byOrder);
  const unassigned = open.filter(({ assignee }) => assignee === null);
  return {
    ready: unassigned
      .filter(({ estimate }) => estimate !== null)
      .map(toReady)
      .filter(({ waitingOn }) => waitingOn.length === 0),
    yours: open.filter(({ assignee }) => assignee !== null).map(toReady),
    needsSize: unassigned.filter(({ estimate }) => estimate === null).map(toReady)
  };
};

// What an issue finishing has just made ready: the ready issues it was blocking.
export const unblockedBy = ({ ready }: ReadyList, identifier: string): ReadyIssue[] =>
  ready.filter(({ blockedBy }) => blockedBy.includes(identifier));
