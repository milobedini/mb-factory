import Link from 'next/link';

const SECTIONS = [
  { title: 'Usage', detail: '5-hour and weekly windows, governor state, queue', href: '/usage' },
  { title: 'Dashboard', detail: 'Autonomy, cycle time, usage per PR' },
  { title: 'Runs', detail: 'Every stage run, grouped by work item', href: '/runs' },
  { title: 'Inbox', detail: 'Questions, spec reviews and PRs waiting on you', href: '/inbox' }
];

const Home = () => (
  <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">mb-factory</h1>
      <p className="text-foreground/70">The factory console. Pages without a link are still to come.</p>
    </header>
    <ul className="grid gap-4 sm:grid-cols-2">
      {SECTIONS.map(({ title, detail, href }) => (
        <li key={title} className="border-foreground/15 rounded-lg border p-4">
          <h2 className="font-medium">
            {href ? (
              <Link href={href} className="underline-offset-2 hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          <p className="text-foreground/70 text-sm">{detail}</p>
        </li>
      ))}
    </ul>
  </main>
);

export default Home;
