/**
 * Reactive workspace file suggestion loading for the TUI.
 */

type Accessor<T> = () => T;
type Setter<T> = (value: T | ((previous: T) => T)) => void;
import {
  getFileSuggestionQuery,
  loadWorkspaceFileSuggestions,
  type FileSuggestionItem
} from "../file-suggestions.ts";

/** Options for workspace file suggestion loading. */
export interface WorkspaceFileSuggestionLoaderOptions {
  readonly draft: Accessor<string>;
  readonly workspaceRoot: Accessor<string>;
  readonly fileSuggestionVersion: Accessor<number>;
  readonly setWorkspaceFiles: Setter<readonly FileSuggestionItem[]>;
  readonly setWorkspaceFilesLoading: Setter<boolean>;
}

/** Load workspace file suggestions only while the draft contains an active @file query. */
export function registerWorkspaceFileSuggestionLoader(
  options: WorkspaceFileSuggestionLoaderOptions
): void {
  {
    const query = getFileSuggestionQuery(options.draft());
    const workspaceRoot = options.workspaceRoot();
    options.fileSuggestionVersion();

    if (query === undefined) {
      options.setWorkspaceFilesLoading(false);
      return;
    }

    let cancelled = false;
    options.setWorkspaceFilesLoading(true);

    void loadWorkspaceFileSuggestions(workspaceRoot)
      .then((nextFiles) => {
        if (!cancelled) {
          options.setWorkspaceFiles(nextFiles);
        }
      })
      .finally(() => {
        if (!cancelled) {
          options.setWorkspaceFilesLoading(false);
        }
      });

    void cancelled;
  }
}
