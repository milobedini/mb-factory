import type { Metadata } from 'next';
import { Suspense } from 'react';

import { DashboardPanels } from './dashboard-panels';

export const metadata: Metadata = { title: 'Dashboard · mb-factory' };

const DashboardPage = ({ searchParams }: PageProps<'/dashboard'>) => (
  <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-foreground/70">
        How the factory is doing: how much it finishes on its own, how long PRs take and where they wait, and what they
        cost. Costs are API-equivalent: a comparison, not a bill.
      </p>
    </header>
    <Suspense fallback={<p className="text-foreground/70">Loading the dashboard…</p>}>
      <DashboardPanels searchParams={searchParams} />
    </Suspense>
  </main>
);

export default DashboardPage;
