/**
 * Starts the page's clock at the moment the demo snapshot was taken, so "today",
 * this period and the calendar match the recorded data. Time still moves on from there.
 */
export function startClockAt(epochMs: number, RealDate: DateConstructor = Date): DateConstructor {
  const offset = epochMs - RealDate.now();
  class DemoDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [string | number | Date]));
    }
    static override now() {
      return RealDate.now() + offset;
    }
  }
  return DemoDate as DateConstructor;
}
