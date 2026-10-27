import type { Metadata } from 'next';
import { Suspense } from 'react';

import { GitHubConnection } from './github-connection';
import { UsageDashboard } from './usage-dashboard';

export const metadata: Metadata = { title: 'Usage · mb-factory' };

const UsagePage = () => (
  <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">Usage</h1>
      <p className="text-foreground/70">
        The factory shares your Claude plan’s 5-hour and weekly limits with your own use. Every dispatch goes through
        the governor below.
      </p>
    </header>
    <Suspense fallback={<p className="text-foreground/70">Loading usage…</p>}>
      <UsageDashboard />
    </Suspense>
    <Suspense fallback={null}>
      <GitHubConnection />
    </Suspense>
  </main>
);

export default UsagePage;
