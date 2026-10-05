import { describe, expect, it } from 'vitest';
import { presetRange, trimLeading } from './presets';

describe('report presets', () => {
  it('works out Australian financial years', () => {
    expect(presetRange('fy-to-date', '2026-10-06', 7)).toEqual({ from: '2026-07-01', to: '2026-10-06' });
    expect(presetRange('fy-to-date', '2026-03-06', 7)).toEqual({ from: '2025-07-01', to: '2026-03-06' });
    expect(presetRange('last-fy', '2026-10-06', 7)).toEqual({ from: '2025-07-01', to: '2026-06-30' });
    expect(presetRange('last-fy', '2026-10-06', 1)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('handles month presets across year ends', () => {
    expect(presetRange('this-month', '2026-01-15', 7)).toEqual({ from: '2026-01-01', to: '2026-01-15' });
    expect(presetRange('last-month', '2026-01-15', 7)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('last-month', '2028-03-15', 7)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(presetRange('last-12', '2026-10-06', 7)).toEqual({ from: '2025-11-01', to: '2026-10-06' });
  });
});

describe('trimLeading', () => {
  it('drops leading empty rows only', () => {
    expect(trimLeading([0, 0, 3, 0, 5], (v) => v === 0)).toEqual([3, 0, 5]);
    expect(trimLeading([1, 0], (v) => v === 0)).toEqual([1, 0]);
    expect(trimLeading([0, 0], (v) => v === 0)).toEqual([0, 0]); // all empty: keep the range on the axis
  });
});
