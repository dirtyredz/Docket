// /api/repos: the overview (every registered repo, its preferred checkout's open counts and loading or
// unavailable state). `?refresh=1` starts a progressive catalog refresh; the response never waits for it.
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
  ];
}
