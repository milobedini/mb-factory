import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RunsTimeline } from './runs-timeline';

export const metadata: Metadata = { title: 'Runs · mb-factory' };

const RunsPage = () => (
  <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">Runs</h1>
      <p className="text-foreground/70">
        Every stage run, grouped by work item, most recently active first. Costs are API-equivalent: a comparison, not a
        bill.
      </p>
    </header>
    <Suspense fallback={<p className="text-foreground/70">Loading runs…</p>}>
      <RunsTimeline />
    </Suspense>
  </main>
);

export default RunsPage;
