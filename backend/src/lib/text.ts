/** Formatting for server-written text such as notification and email bodies. */
export function formatCentsForText(cents: number, ctx: { currency: string; locale: string }): string {
  return new Intl.NumberFormat(ctx.locale, { style: 'currency', currency: ctx.currency }).format(cents / 100);
}

export function formatDateForText(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
