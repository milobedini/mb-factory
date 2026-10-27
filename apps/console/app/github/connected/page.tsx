import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'GitHub connected · mb-factory' };

// Where Connect GitHub ends. Open to anyone: it shows only the login GitHub sent back, and nothing from the database.
const ConnectedPage = async ({ searchParams }: PageProps<'/github/connected'>) => {
  const { login } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-24 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">GitHub connected</h1>
      <p className="text-foreground/70">
        {typeof login === 'string' ? `Connected as ${login}. ` : ''}Go back to Slack and tap Approve and merge: it
        approves and merges as you. Disconnect from the console’s Usage page whenever you like.
      </p>
    </main>
  );
};

export default ConnectedPage;
