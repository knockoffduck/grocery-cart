import { useCallback, useEffect } from "react";
import { hapticTrigger } from "ios-haptics";

const MARKER = "data-haptic-applied";

/**
 * Returns a stable callback ref that attaches the ios-haptics overlay to
 * any element it's bound to. Safe to pass directly as `ref={hapticRef}` —
 * the callback identity is stable so React won't churn the ref on re-renders.
 *
 * Usage:
 *   const hapticRef = useHaptic<HTMLButtonElement>();
 *   <button ref={hapticRef}>Tap me</button>
 */
export function useHaptic<T extends HTMLElement = HTMLElement>(): (
  el: T | null,
) => void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((el: T | null) => {
    if (!el || el.hasAttribute(MARKER)) return;
    el.setAttribute(MARKER, "");
    hapticTrigger(el);
  }, []);
}

/**
 * Applies hapticTrigger to an element held by an existing ref.
 * Useful when the ref is already needed for something else (e.g. video element).
 */
export function useHapticOn<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || el.hasAttribute(MARKER)) return;
    el.setAttribute(MARKER, "");
    hapticTrigger(el);
  }, [ref]);
}
