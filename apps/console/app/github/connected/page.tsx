import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: 'GitHub connected · mb-factory' };

const ConnectedAs = async ({ searchParams }: Pick<PageProps<'/github/connected'>, 'searchParams'>) => {
  const { login } = await searchParams;
  return typeof login === 'string' ? `Connected as ${login}. ` : null;
};

// Where Connect GitHub ends. Open to anyone: it shows only the login GitHub sent back, and nothing from the database.
const ConnectedPage = ({ searchParams }: PageProps<'/github/connected'>) => (
  <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-24 sm:px-6">
    <h1 className="text-3xl font-semibold tracking-tight">GitHub connected</h1>
    <p className="text-foreground/70">
      <Suspense fallback={null}>
        <ConnectedAs searchParams={searchParams} />
      </Suspense>
      Go back to Slack and tap Approve and merge: it approves and merges as you. Disconnect from the console’s Usage
      page whenever you like.
    </p>
  </main>
);

export default ConnectedPage;
