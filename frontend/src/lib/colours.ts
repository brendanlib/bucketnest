/**
 * Default bucket colours have a validated dark-mode step. A stored default hex is
 * shown through a CSS token so it swaps with the theme; a colour the user picked
 * is shown as-is.
 */
const TOKENS: Record<string, string> = {
  '#2A78D6': 'var(--bucket-1)',
  '#4A3AA7': 'var(--bucket-2)',
  '#1BAF7A': 'var(--bucket-3)',
  '#EB6834': 'var(--bucket-4)',
};

export function bucketColour(hex: string | null | undefined): string {
  if (!hex) return 'var(--border)';
  return TOKENS[hex.toUpperCase()] ?? hex;
}
