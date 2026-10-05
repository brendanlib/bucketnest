import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from './csv.js';
import { normaliseDescription, parseBankAmount, parseBankDate } from './parse.js';
import { applyMapping, detectHeader, guessDateFormat, guessMapping } from './mapping.js';
import { fingerprintRows } from './fingerprint.js';
import { firstMatchingRule, ruleMatches, type RuleSpec } from './rules.js';
import { amountsMatch, pairClosest } from './match.js';

describe('parseCsv', () => {
  it('handles quotes, embedded delimiters, doubled quotes, CRLF and a BOM', () => {
    const text = '﻿Date,Description,Amount\r\n01/10/2026,"WOOLWORTHS, SYDNEY",-82.40\r\n02/10/2026,"He said ""hi""",10\n\n03/10/2026,"multi\nline",5';
    expect(parseCsv(text, ',')).toEqual([
      ['Date', 'Description', 'Amount'],
      ['01/10/2026', 'WOOLWORTHS, SYDNEY', '-82.40'],
      ['02/10/2026', 'He said "hi"', '10'],
      ['03/10/2026', 'multi\nline', '5'],
    ]);
  });

  it('keeps empty fields and a final line without newline', () => {
    expect(parseCsv('a,,c\n1,2,', ',')).toEqual([
      ['a', '', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('detects the delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('"x, y",b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a|b\n1|2')).toBe('|');
    expect(detectDelimiter('single')).toBe(',');
  });
});

describe('bank values', () => {
  it.each([
    ['01/10/2026', 'DD/MM/YYYY', '2026-10-01'],
    ['1/10/2026', 'DD/MM/YYYY', '2026-10-01'],
    ['01-10-2026', 'DD/MM/YYYY', '2026-10-01'],
    ['1/10/26', 'D/M/YY', '2026-10-01'],
    ['2026-10-01', 'YYYY-MM-DD', '2026-10-01'],
    ['2026-10-01T10:00:00', 'YYYY-MM-DD', '2026-10-01'],
    ['10/01/2026', 'MM/DD/YYYY', '2026-10-01'],
    ['01 Oct 2026', 'DD MMM YYYY', '2026-10-01'],
    ['1-Oct-26', 'DD MMM YYYY', '2026-10-01'],
  ] as const)('parses %s as %s', (v, f, iso) => {
    expect(parseBankDate(v, f)).toBe(iso);
  });

  it.each([
    ['31/02/2026', 'DD/MM/YYYY'],
    ['2026-13-01', 'YYYY-MM-DD'],
    ['01 Foo 2026', 'DD MMM YYYY'],
    ['hello', 'DD/MM/YYYY'],
  ] as const)('rejects %s', (v, f) => {
    expect(parseBankDate(v, f)).toBeNull();
  });

  it.each([
    ['-82.40', -8240],
    ['$1,234.50', 123450],
    ['(12.00)', -1200],
    ['12.00 CR', 1200],
    ['12.00 DR', -1200],
    ['12.00-', -1200],
    ['+5', 500],
    ['AUD 10.10', 1010],
    ['-$3.50', -350],
    ['.5', 50],
  ])('parses amount %s', (v, cents) => {
    expect(parseBankAmount(v)).toBe(cents);
  });

  it.each(['', 'abc', '1.234', '1e5', '$'])('rejects amount %j', (v) => {
    expect(parseBankAmount(v)).toBeNull();
  });

  it('normalises descriptions', () => {
    expect(normaliseDescription('  Woolworths   1234  sydney ')).toBe('WOOLWORTHS 1234 SYDNEY');
  });
});

describe('mapping', () => {
  it('guesses a CommBank-style file with no header', () => {
    const rows = parseCsv('01/10/2026,"-82.40","WOOLWORTHS 1234 SYDNEY","+4,117.60"\n02/10/2026,"+3500.00","SALARY ACME PTY LTD","+7,617.60"', ',');
    expect(detectHeader(rows)).toBe(false);
    const m = guessMapping(rows, ',');
    expect(m).toMatchObject({ hasHeader: false, dateColumn: 0, amountColumn: 1, descriptionColumn: 2, dateFormat: 'DD/MM/YYYY', signConvention: 'NEGATIVE_IS_DEBIT' });
    const parsed = applyMapping(rows, m);
    expect(parsed[0]).toMatchObject({ date: '2026-10-01', amountCents: 8240, direction: 'debit', description: 'WOOLWORTHS 1234 SYDNEY', errors: [] });
    expect(parsed[1]).toMatchObject({ amountCents: 350000, direction: 'credit' });
  });

  it('guesses debit and credit columns from headers', () => {
    const rows = parseCsv('Date,Narrative,Debit Amount,Credit Amount,Balance\n2026-10-01,Coffee,4.50,,95.50\n2026-10-02,Refund,,10.00,105.50', ',');
    const m = guessMapping(rows, ',');
    expect(m).toMatchObject({ hasHeader: true, dateColumn: 0, descriptionColumn: 1, debitColumn: 2, creditColumn: 3, balanceColumn: 4, signConvention: 'DEBIT_CREDIT_COLUMNS', dateFormat: 'YYYY-MM-DD', amountColumn: null });
    const parsed = applyMapping(rows, m);
    expect(parsed.map((p) => [p.direction, p.amountCents, p.balanceCents])).toEqual([
      ['debit', 450, 9550],
      ['credit', 1000, 10550],
    ]);
  });

  it('supports cards that export purchases as positive numbers', () => {
    const rows = parseCsv('Date,Description,Amount\n01/10/2026,JB HI FI,199.00\n05/10/2026,PAYMENT THANK YOU,-199.00', ',');
    const parsed = applyMapping(rows, { ...guessMapping(rows, ','), signConvention: 'POSITIVE_IS_DEBIT' });
    expect(parsed.map((p) => p.direction)).toEqual(['debit', 'credit']);
  });

  it('reports per-row errors', () => {
    const rows = parseCsv('Date,Description,Amount\n31/02/2026,Bad date,1\n01/10/2026,,abc\n02/10/2026,Zero,0', ',');
    const parsed = applyMapping(rows, guessMapping(rows, ','));
    expect(parsed[0]!.errors[0]).toMatch(/not a DD\/MM\/YYYY date/);
    expect(parsed[1]!.errors).toEqual(expect.arrayContaining([expect.stringMatching(/not an amount/), 'Missing description']));
    expect(parsed[2]!.errors).toContain('Amount is zero');
  });

  it('guesses date formats from the data', () => {
    expect(guessDateFormat(['10/31/2026', '11/01/2026'])).toBe('MM/DD/YYYY');
    expect(guessDateFormat(['31/10/2026'])).toBe('DD/MM/YYYY');
    expect(guessDateFormat(['05 Oct 2026'])).toBe('DD MMM YYYY');
  });
});

describe('fingerprints', () => {
  it('are stable, account-specific, and distinguish identical rows on one day', () => {
    const rows = [
      { date: '2026-10-01', amountCents: 450, direction: 'debit' as const, description: 'Coffee' },
      { date: '2026-10-01', amountCents: 450, direction: 'debit' as const, description: ' COFFEE ' },
      { date: '2026-10-01', amountCents: 450, direction: 'credit' as const, description: 'Coffee' },
    ];
    const a = fingerprintRows('acct-1', rows);
    expect(new Set(a).size).toBe(3);
    expect(fingerprintRows('acct-1', rows)).toEqual(a);
    expect(fingerprintRows('acct-2', rows)[0]).not.toBe(a[0]);
  });
});

describe('rules', () => {
  const rule = (over: Partial<RuleSpec>): RuleSpec => ({ id: 'r', priority: 1, isActive: true, matchField: 'DESCRIPTION', matchType: 'CONTAINS', matchValue: 'woolworths', ...over });
  const t = { description: 'WOOLWORTHS 1234 SYDNEY', payee: 'Woolies', amountCents: 8240, direction: 'debit' as const, accountId: 'a1' };

  it('matches case-insensitively by contains, starts with and equals', () => {
    expect(ruleMatches(rule({}), t)).toBe(true);
    expect(ruleMatches(rule({ matchType: 'STARTS_WITH', matchValue: 'Woolworths 12' }), t)).toBe(true);
    expect(ruleMatches(rule({ matchType: 'STARTS_WITH', matchValue: '1234' }), t)).toBe(false);
    expect(ruleMatches(rule({ matchType: 'EQUALS', matchValue: 'woolworths  1234 sydney' }), t)).toBe(true);
    expect(ruleMatches(rule({ matchField: 'PAYEE', matchType: 'EQUALS', matchValue: 'woolies' }), t)).toBe(true);
  });

  it('treats the match value as text, never as a pattern', () => {
    expect(ruleMatches(rule({ matchValue: '.*' }), t)).toBe(false);
    expect(ruleMatches(rule({ matchValue: '(a+)+$' }), { ...t, description: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' })).toBe(false);
  });

  it('applies amount, account and direction conditions', () => {
    expect(ruleMatches(rule({ minAmountCents: 9000 }), t)).toBe(false);
    expect(ruleMatches(rule({ maxAmountCents: 8000 }), t)).toBe(false);
    expect(ruleMatches(rule({ minAmountCents: 8240, maxAmountCents: 8240 }), t)).toBe(true);
    expect(ruleMatches(rule({ accountId: 'other' }), t)).toBe(false);
    expect(ruleMatches(rule({ direction: 'CREDIT' }), t)).toBe(false);
    expect(ruleMatches(rule({ direction: 'DEBIT' }), t)).toBe(true);
    expect(ruleMatches(rule({ isActive: false }), t)).toBe(false);
    expect(ruleMatches(rule({ matchValue: '   ' }), t)).toBe(false);
  });

  it('first match by priority wins', () => {
    const rules = [rule({ id: 'b', priority: 2 }), rule({ id: 'a', priority: 1, matchValue: 'woolworths 1234' }), rule({ id: 'c', priority: 0, matchValue: 'coles' })];
    expect(firstMatchingRule(rules, t)?.id).toBe('a');
    expect(firstMatchingRule([], t)).toBeNull();
  });
});

describe('matching', () => {
  it('fixed amounts must match exactly, estimates within 20%', () => {
    expect(amountsMatch(2500, 2500, 'FIXED')).toBe(true);
    expect(amountsMatch(2500, 2501, 'FIXED')).toBe(false);
    expect(amountsMatch(45000, 54000, 'ESTIMATE')).toBe(true);
    expect(amountsMatch(45000, 36000, 'ESTIMATE')).toBe(true);
    expect(amountsMatch(45000, 54001, 'ESTIMATE')).toBe(false);
  });

  it('pairs rows with candidates within ±3 days, closest first, once each', () => {
    const rows = [
      { date: '2026-10-02', amountCents: 2500, direction: 'debit' as const },
      { date: '2026-10-05', amountCents: 2500, direction: 'debit' as const },
      null,
      { date: '2026-10-02', amountCents: 2500, direction: 'credit' as const },
    ];
    const cands = [
      { date: '2026-10-01', amountCents: 2500, direction: 'debit' as const },
      { date: '2026-10-09', amountCents: 2500, direction: 'debit' as const },
    ];
    const pairs = pairClosest(rows, cands, (r, c) => r.amountCents === c.amountCents);
    expect([...pairs]).toEqual([[0, 0]]);
  });
});
