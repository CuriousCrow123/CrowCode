/**
 * Starts a repeating action on press-and-hold with accelerating delta.
 * Fires immediately with delta=1, then after `delay` ms begins repeating
 * at `interval` ms. Delta doubles every `accelMs` ms of elapsed repeat time.
 * Returns a cleanup function to stop the repeat.
 */
export function startRepeat(
  action: (delta: number) => void,
  delay: number,
  interval: number,
  accelMs: number,
): () => void {
  let elapsed = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  action(1);

  timer = setTimeout(function tick() {
    elapsed += interval;
    const delta = 2 ** Math.floor(elapsed / accelMs);
    action(delta);
    timer = setTimeout(tick, interval);
  }, delay);

  return () => {
    if (timer !== null) clearTimeout(timer);
  };
}
