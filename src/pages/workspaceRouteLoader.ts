let workspaceRouteLoaderPromise: Promise<typeof import("./Workspace")> | null = null;

export function loadWorkspaceRoute() {
  if (!workspaceRouteLoaderPromise) {
    workspaceRouteLoaderPromise = import("./Workspace");
  }
  return workspaceRouteLoaderPromise;
}

