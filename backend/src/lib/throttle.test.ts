import { describe, expect, it } from 'vitest';
import { AttemptThrottle } from './throttle.js';

describe('AttemptThrottle', () => {
  it('limits attempts per window and backs off after repeated failures', () => {
    let t = 0;
    const throttle = new AttemptThrottle(2, 60_000, () => t);
    expect(throttle.hit('k')).toBeNull();
    expect(throttle.hit('k')).toBeNull();
    expect(throttle.hit('k')).toBe(60);
    t = 60_000;
    expect(throttle.hit('k')).toBeNull();

    throttle.fail('k');
    throttle.fail('k');
    expect(throttle.hit('k')).toBeNull();
    throttle.fail('k'); // third failure: 2s block
    expect(throttle.hit('k')).toBe(2);
    t += 2_000;
    throttle.succeed('k');
    expect(throttle.hit('k')).toBeNull();
  });

  it('prunes stale entries', () => {
    let t = 0;
    const throttle = new AttemptThrottle(1, 1_000, () => t);
    throttle.hit('a');
    t = 5_000;
    throttle.prune();
    expect(throttle.hit('a')).toBeNull();
  });
});
