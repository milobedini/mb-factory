import type { Metadata } from 'next';
import { Suspense } from 'react';

import { InboxList } from './inbox-list';

export const metadata: Metadata = { title: 'Inbox · mb-factory' };

const InboxPage = () => (
  <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
      <p className="text-foreground/70">
        Everything waiting on you, oldest first. Items leave on their own once they’re answered, approved, merged or
        running again.
      </p>
    </header>
    <Suspense fallback={<p className="text-foreground/70">Loading the inbox…</p>}>
      <InboxList />
    </Suspense>
  </main>
);

export default InboxPage;
