// /api/repos: the overview (every registered repo, its preferred checkout's open counts and loading or
// unavailable state). `?refresh=1` starts a progressive catalog refresh; the response never waits for it.
// /api/repos/:repo/worktrees: advisory worktree, branch and claim hints for one repo.
import { openScoped } from "../scope.mjs";
import { worktreeHints } from "../worktree-hints.mjs";

export function repoRoutes(deps) {
  const { catalog } = deps;
  return [
    {
      method: "GET",
      path: "/api/repos",
      handler: ({ query }) => {
        if (query.get("refresh") === "1") catalog.refresh({ force: query.get("force") === "1" });
        return catalog.overview();
      },
    },
    {
      method: "GET",
      path: "/api/repos/:repo/worktrees",
      handler: ({ params }) => {
        const { repo, ctx } = openScoped(deps, { repo: params.repo });
        return { repo: { id: repo.id, alias: repo.alias }, ...worktreeHints(repo, ctx) };
      },
    },
  ];
}
