// Express (Phase 5, docs/express.md) is an agent-first track: no spec or Spec Review, implement asks the spec's
// questions before it codes, and review never asks. Careful is the pipeline as it was.
export const TRACKS = ['express', 'careful'] as const;

export type Track = (typeof TRACKS)[number];

// An issue's `express` or `careful` label overrides the project's track. With both, careful wins: a label can always
// tighten the track, and loosening it takes taking `careful` off.
export const trackFor = (projectTrack: Track, labels: string[]): Track => {
  const named = labels.map((label) => label.trim().toLowerCase());
  return named.includes('careful') ? 'careful' : named.includes('express') ? 'express' : projectTrack;
};
