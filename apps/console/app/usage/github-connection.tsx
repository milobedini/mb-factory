import { findConnection } from '@/lib/github-connect';
import { consoleTimeZone } from '@/lib/projects';
import { requireConsoleUser } from '@/lib/session';

import { disconnectGitHubAction } from './actions';

const day = (at: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: consoleTimeZone(),
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(at);

// Approve and merge in Slack acts as the person who taps, through their GitHub connection.
export const GitHubConnection = async () => {
  const user = await requireConsoleUser();
  const connection = await findConnection(user.id);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">GitHub for Slack merges</h2>
      <div className="border-foreground/15 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <p className="text-foreground/70">
          {connection
            ? `Connected as ${connection.login} since ${day(connection.since)}. Approve and merge in Slack approves and merges as you.`
            : 'Not connected. Connect once so Approve and merge in Slack can approve and merge as you.'}
        </p>
        {connection ? (
          <form action={disconnectGitHubAction}>
            <button
              type="submit"
              className="border-foreground/20 hover:bg-foreground/5 rounded-md border px-3 py-1.5 text-sm"
            >
              Disconnect
            </button>
          </form>
        ) : (
          <a
            href="/api/github/connect/start"
            className="border-foreground/20 hover:bg-foreground/5 rounded-md border px-3 py-1.5 text-sm"
          >
            Connect GitHub
          </a>
        )}
      </div>
    </section>
  );
};
