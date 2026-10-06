import { useBuckets } from '../api/hooks';

export interface BucketNames {
  bills: string;
  saving: string;
}

const DEFAULTS: BucketNames = { bills: 'Bills', saving: 'Fire Extinguisher' };

/** The current names of the two buckets the rules use (households can rename them). */
export function useBucketNames(): BucketNames {
  const buckets = useBuckets();
  const find = (role: 'BILLS' | 'SAVING') => buckets.data?.find((b) => b.role === role)?.name;
  return { bills: find('BILLS') ?? DEFAULTS.bills, saving: find('SAVING') ?? DEFAULTS.saving };
}

/** Rewrites help text written with the default names to use the household's names. */
export function withBucketNames(text: string, names: BucketNames): string {
  return text.replace(/Fire Extinguisher/g, names.saving).replace(/\bBills\b/g, names.bills);
}
