/**
 * Starts a repeating action on press-and-hold with accelerating delta.
 * Fires immediately with delta=1, then after `delay` ms begins repeating
 * at `interval` ms. Delta doubles every `accelMs` ms of elapsed repeat time.
 * Returns a cleanup function to stop the repeat.
 *
 * The action callback must be synchronous — if a tick is already executing
 * when cleanup is called, it will complete but no further ticks will fire.
 */
export function startRepeat(
  action: (delta: number) => void,
  delay: number,
  interval: number,
  accelMs: number,
): () => void {
  let elapsed = 0;
  let canceled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  action(1);

  timer = setTimeout(function tick() {
    if (canceled) return;
    elapsed += interval;
    const delta = 2 ** Math.floor(elapsed / accelMs);
    action(delta);
    timer = setTimeout(tick, interval);
  }, delay);

  return () => {
    canceled = true;
    if (timer !== null) clearTimeout(timer);
  };
}
