/**
 * Role-scoped state management for acting-capacity switches.
 *
 * When the acting role changes, everything the previous capacity
 * loaded must be discarded — the new capacity sees only what ITS
 * grants permit. This module owns the four clearing mechanisms:
 *
 * 1. In-flight requests — pages register their AbortController; a
 *    switch aborts every outstanding role-scoped request.
 * 2. Role-keyed caches — a shared cache map, cleared on switch.
 * 3. Role tabs — the switcher navigates back to the dashboard, closing
 *    whatever role-specific view was open.
 * 4. Filters — pages register a filter-reset function; a switch runs
 *    them all (pages with filters register in Phase 2+).
 */

const abortControllers = new Set<AbortController>();

/** Register an in-flight role-scoped request's controller. */
export function registerAbortController(controller: AbortController): () => void {
  abortControllers.add(controller);
  return () => {
    abortControllers.delete(controller);
  };
}

const roleKeyedCache = new Map<string, unknown>();

/** Read from the role-keyed cache (cleared on every switch). */
export function roleCacheGet<T>(key: string): T | undefined {
  return roleKeyedCache.get(key) as T | undefined;
}

/** Write to the role-keyed cache (cleared on every switch). */
export function roleCacheSet<T>(key: string, value: T): void {
  roleKeyedCache.set(key, value);
}

const filterResets = new Set<() => void>();

/** Register a page filter-reset function (run on every switch). */
export function registerFilterReset(reset: () => void): () => void {
  filterResets.add(reset);
  return () => {
    filterResets.delete(reset);
  };
}

/**
 * Clear all role-scoped state. Called by AuthContext.switchActingRole
 * BEFORE the new acting capacity is set, so no stale data survives.
 */
export function clearRoleScopedState(): void {
  for (const controller of abortControllers) {
    try {
      controller.abort();
    } catch {
      // Already settled — nothing to abort.
    }
  }
  abortControllers.clear();
  roleKeyedCache.clear();
  for (const reset of filterResets) {
    try {
      reset();
    } catch {
      // A page's reset must never block the switch.
    }
  }
}
