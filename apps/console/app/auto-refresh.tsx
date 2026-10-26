'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const REFRESH_MS = 10_000;

// Polls the server while there's something to watch, so open runs and waiting items change without a reload, and
// skips the tick while the tab is hidden. The server says when to stop by rendering this with `active` false.
export const AutoRefresh = ({ active }: { active: boolean }) => {
  const router = useRouter();
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
};
