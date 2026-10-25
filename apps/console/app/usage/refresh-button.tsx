'use client';

import { useActionState } from 'react';

import type { RefreshState } from './actions';
import { refreshAction } from './actions';

export const RefreshButton = () => {
  const [state, action, pending] = useActionState<RefreshState>(refreshAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="border-foreground/20 hover:bg-foreground/5 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {pending ? 'Starting…' : 'Refresh (probe)'}
      </button>
      {state && (
        <p role="status" className="text-foreground/70 text-right text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
};
