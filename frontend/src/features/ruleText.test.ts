import { describe, expect, it } from 'vitest';
import { ruleTextFor } from './TransactionsPage';

describe('ruleTextFor', () => {
  it.each([
    ['WOOLWORTHS 1234 SYDNEY', 'WOOLWORTHS'],
    ['NETFLIX.COM', 'NETFLIX.COM'],
    ['CAFE NERO PARRAMATTA AU', 'CAFE NERO PARRAMATTA'],
    ['1234 ATM WITHDRAWAL', '1234 ATM WITHDRAWAL'],
    ['  Spotify   P1A2B3 ', 'Spotify'],
  ])('%s → %s', (input, expected) => {
    expect(ruleTextFor(input)).toBe(expected);
  });
});
