import { sizeLabel } from './dashboard';

// An issue in one of the team's projects that nobody has started, as Linear reports it.
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
  project: { name: string; sortOrder: number; statusType: string };
  // Every issue that blocks this one, with whether it's finished.
  blockers: { identifier: string; finished: boolean }[];
};

export type ReadyIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  project: string;
  size: string;
  assignee: string | null;
  // Every issue that blocks this one, finished or not.
  blockedBy: string[];
  // Blockers not yet finished; only an issue that's someone's can have any.
  waitingOn: string[];
};

export type ReadyList = { ready: ReadyIssue[]; yours: ReadyIssue[] };

const CLOSED_PROJECT = ['completed', 'canceled'];

const issueNumber = (identifier: string): number => Number(identifier.split('-').at(-1));

// Urgent first and no priority last, as Linear sorts them.
const priorityRank = (priority: number): number => (priority === 0 ? 5 : priority);

// The projects in the order the team keeps them, then by priority, then oldest first.
const byOrder = (a: CandidateIssue, b: CandidateIssue): number =>
  a.project.sortOrder - b.project.sortOrder ||
  priorityRank(a.priority) - priorityRank(b.priority) ||
  issueNumber(a.identifier) - issueNumber(b.identifier);

const toReady = (issue: CandidateIssue): ReadyIssue => ({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  url: issue.url,
  project: issue.project.name,
  size: sizeLabel(issue.estimate),
  assignee: issue.assignee,
  blockedBy: issue.blockers.map(({ identifier }) => identifier),
  waitingOn: issue.blockers.filter(({ finished }) => !finished).map(({ identifier }) => identifier)
});

// What can be delegated now: in an open project, not delegated or assigned, nothing left blocking it. An issue
// assigned to a person is theirs to do, so it's listed apart and never offered to the factory.
export const readyList = (issues: CandidateIssue[]): ReadyList => {
  const open = issues
    .filter(({ delegated, project }) => !delegated && !CLOSED_PROJECT.includes(project.statusType))
    .toSorted(byOrder)
    .map(toReady);
  return {
    ready: open.filter(({ assignee, waitingOn }) => assignee === null && waitingOn.length === 0),
    yours: open.filter(({ assignee }) => assignee !== null)
  };
};

// What an issue finishing has just made ready: the ready issues it was blocking.
export const unblockedBy = ({ ready }: ReadyList, identifier: string): ReadyIssue[] =>
  ready.filter(({ blockedBy }) => blockedBy.includes(identifier));
