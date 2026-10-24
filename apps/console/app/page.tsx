const SECTIONS = [
  { title: 'Dashboard', detail: 'Autonomy, cycle time, usage per PR' },
  { title: 'Usage', detail: '5-hour and weekly windows, governor state, queue' },
  { title: 'Runs', detail: 'Every stage run, grouped by work item' },
  { title: 'Inbox', detail: 'Questions, spec reviews and PRs waiting on you' }
];

const Home = () => (
  <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-16">
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold tracking-tight">mb-factory</h1>
      <p className="text-foreground/70">The console is being built. Webhook endpoints are live under /api/webhooks.</p>
    </header>
    <ul className="grid gap-4 sm:grid-cols-2">
      {SECTIONS.map(({ title, detail }) => (
        <li key={title} className="border-foreground/15 rounded-lg border p-4">
          <h2 className="font-medium">{title}</h2>
          <p className="text-foreground/70 text-sm">{detail}</p>
        </li>
      ))}
    </ul>
  </main>
);

export default Home;
