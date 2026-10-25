import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in · mb-factory' };

const LoginPage = () => (
  <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-24 sm:px-6">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">mb-factory</h1>
      <p className="text-foreground/70">The console is open to its operator only.</p>
    </header>
    <a
      href="/api/auth/github/start"
      className="bg-foreground text-background self-start rounded-md px-4 py-2 text-sm font-medium"
    >
      Sign in with GitHub
    </a>
  </main>
);

export default LoginPage;
