import { z } from 'zod';
import { isValidDateOnly } from '../finance/dates.js';

/** Integer cents as a JSON number. */
export const Cents = z.number().int().refine(Number.isSafeInteger, 'Amount out of range');
export const PositiveCents = Cents.refine((v) => v > 0, 'Amount must be greater than 0');
export const NonNegativeCents = Cents.refine((v) => v >= 0, 'Amount cannot be negative');

/** YYYY-MM-DD between 1900 and 2100. */
export const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(isValidDateOnly, 'Not a real date')
  .refine((v) => v >= '1900-01-01' && v <= '2100-12-31', 'Date must be between 1900 and 2100');

export const Id = z.uuid();
export const IdParams = z.strictObject({ id: Id });

export const Pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};

export const Name = z.string().trim().min(1, 'Required').max(120);
export const OptionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export const BooleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const Frequency = z.enum([
  'WEEKLY',
  'FORTNIGHTLY',
  'MONTHLY',
  'QUARTERLY',
  'SIX_MONTHLY',
  'ANNUALLY',
  'EVERY_N_DAYS',
  'EVERY_N_WEEKS',
  'EVERY_N_MONTHS',
]);
