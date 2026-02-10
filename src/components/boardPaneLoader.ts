let boardPaneLoaderPromise: Promise<typeof import("./BoardPane")> | null = null;

export function loadBoardPane() {
  if (!boardPaneLoaderPromise) {
    boardPaneLoaderPromise = import("./BoardPane");
  }
  return boardPaneLoaderPromise;
}

