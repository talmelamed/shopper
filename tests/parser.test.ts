import { describe, expect, it } from 'vitest';
import { parseShoppingList } from '../src/shopping/parser.js';

describe('parseShoppingList', () => {
  it('parses a single item', () => {
    const items = parseShoppingList('חלב');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'חלב', qty: 1, action: 'add' });
  });

  it('parses comma-separated items with quantity prefixes', () => {
    const items = parseShoppingList('2 חלב, 3 לחם, ביצים');
    expect(items.map((i) => ({ name: i.name, qty: i.qty }))).toEqual([
      { name: 'חלב', qty: 2 },
      { name: 'לחם', qty: 3 },
      { name: 'ביצים', qty: 1 },
    ]);
  });

  it('parses multi-line lists', () => {
    const items = parseShoppingList('חלב\nלחם\nביצים');
    expect(items).toHaveLength(3);
  });

  it('parses weight in kg', () => {
    const items = parseShoppingList('1 ק"ג עגבניות');
    expect(items[0]).toMatchObject({ name: 'עגבניות', weightKg: 1 });
  });

  it('parses weight in grams', () => {
    const items = parseShoppingList('500 גרם גבינה');
    expect(items[0]?.weightKg).toBeCloseTo(0.5);
  });

  it('parses brand via @', () => {
    const items = parseShoppingList('קפה שחור 3 @עלית');
    expect(items[0]).toMatchObject({ brand: 'עלית', qty: 3, name: 'קפה שחור' });
  });

  it('parses brand via מותג: label', () => {
    const items = parseShoppingList('שמן זית 2 מותג:שופרסל');
    expect(items[0]).toMatchObject({ brand: 'שופרסל', qty: 2 });
  });

  it('parses brand + weight', () => {
    const items = parseShoppingList('אבקת כביסה @אריאל 7 ק"ג');
    expect(items[0]).toMatchObject({ brand: 'אריאל', weightKg: 7, name: 'אבקת כביסה' });
  });

  it('parses removal by name', () => {
    const items = parseShoppingList('הסר חלב');
    expect(items[0]).toMatchObject({ action: 'remove', name: 'חלב' });
  });

  it('parses removal by cart index', () => {
    const items = parseShoppingList('הסר #3');
    expect(items[0]).toMatchObject({ action: 'remove', cartIndexRef: 3 });
  });

  it('ignores blank lines and # comments', () => {
    const items = parseShoppingList('\n# this is a comment\nחלב\n\n');
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('חלב');
  });

  it('parses x-suffix quantity', () => {
    const items = parseShoppingList('חלב x4');
    expect(items[0]).toMatchObject({ name: 'חלב', qty: 4 });
  });
});
