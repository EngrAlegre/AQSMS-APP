import { useEffect, useState } from "react";

/** Current time, re-rendering every `intervalMs` so "x min ago" and STALE stay accurate. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
