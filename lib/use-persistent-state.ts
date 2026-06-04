"use client";

/**
 * SSR-safe persistent state backed by localStorage, built on
 * useSyncExternalStore.
 *
 * Renders `fallback` during SSR and the initial client render (so hydration
 * matches the server markup), then switches to the stored value — WITHOUT a
 * setState inside an effect. That keeps React's set-state-in-effect lint rule
 * happy and avoids the cascading re-render the `useState` + `useEffect`
 * hydration idiom causes.
 *
 * Writes persist to localStorage and notify same-tab listeners via a custom
 * event (the native `storage` event only fires in OTHER tabs), so multiple
 * components bound to the same key stay in sync.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";

const LOCAL_EVENT = "km:localstorage";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(LOCAL_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(LOCAL_EVENT, callback);
  };
}

export function usePersistentState<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T,
  serialize: (value: T) => string,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  // Cache so getSnapshot returns a STABLE reference while the raw string is
  // unchanged — useSyncExternalStore compares snapshots with Object.is and
  // would loop forever if a non-primitive value were re-parsed every render.
  const cache = useRef<{ raw: string | null; value: T }>({ raw: null, value: fallback });

  const getSnapshot = useCallback((): T => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (raw === cache.current.raw) return cache.current.value;
    let value: T;
    try {
      value = raw == null ? fallback : parse(raw);
    } catch {
      value = fallback;
    }
    cache.current = { raw, value };
    return value;
  }, [key, fallback, parse]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => fallback);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(getSnapshot()) : next;
      try {
        localStorage.setItem(key, serialize(resolved));
      } catch {
        /* quota / disabled */
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(LOCAL_EVENT));
      }
    },
    [key, serialize, getSnapshot],
  );

  return [value, setValue] as const;
}

const noopSubscribe = () => () => {};

/**
 * Returns false during SSR + the first client render, then true once mounted on
 * the client. Effect-free replacement for the
 * `const [m, setM] = useState(false); useEffect(() => setM(true), [])` idiom —
 * handy for gating mount-only behavior (e.g. enabling a CSS transition after
 * first paint) without a hydration mismatch or a setState-in-effect.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
