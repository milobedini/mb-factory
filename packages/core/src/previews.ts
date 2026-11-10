// A Neon branch as Neon's API lists it.
export type NeonBranch = {
  id: string;
  name: string;
  default?: boolean;
  primary?: boolean;
  protected?: boolean;
};

// The Neon-managed Vercel integration names a preview's database branch after its Git branch.
export const previewBranchName = (gitBranch: string): string => `preview/${gitBranch}`;

// The database branch a Git branch's previews used, to delete once its PR closes. Neon's integration deletes it only
// on the next preview deploy, after making that deploy's branch, so once the project is at its branch limit nothing
// is deleted and every preview fails (10 Nov). The project's default, primary or protected branch is never one.
export const previewBranchFor = (branches: NeonBranch[], gitBranch: string): NeonBranch | undefined =>
  branches.find(
    (branch) => branch.name === previewBranchName(gitBranch) && !branch.default && !branch.primary && !branch.protected
  );
