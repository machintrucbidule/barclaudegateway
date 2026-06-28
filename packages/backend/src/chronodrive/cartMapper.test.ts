import { describe, expect, it } from 'vitest';
import type { ActiveCartResponse } from '@barclaudegateway/shared';
import { aggregateCartNutrition, toNormalizedCart } from './cartMapper.js';

type CartContent = ActiveCartResponse['content'][number];

/** A populated cart: line 1 fully described, line 2 missing net weight (incomplete for the aggregate). */
const CART: CartContent = {
  id: 'CART-1',
  isOrdered: false,
  amounts: { totalCartAmount: 10.51, totalOrderAmount: 10.51, totalDiscountAmount: 0 },
  items: [
    {
      quantity: 2,
      product: {
        id: '91574',
        labels: { productLabel: 'Mozzarella', brandLabel: 'AUCHAN' },
        eans: ['3596710335510'],
        prices: { defaultPrice: 1.79, totalAmount: 3.58 },
        packaging: { weight: 0.125 },
        characteristics: {
          features: [
            { code: '563', value: '100 g' },
            { code: '243', value: '262' },
            { code: '168', value: '13' },
          ],
        },
      },
    },
    {
      quantity: 1,
      product: {
        id: '999',
        labels: { productLabel: 'No-weight item' },
        eans: [],
        // No packaging.weight → cannot contribute macros.
        characteristics: { features: [{ code: '243', value: '200' }] },
      },
    },
  ],
};

describe('toNormalizedCart', () => {
  it('maps line items (summary + line total) and cart totals', () => {
    const cart = toNormalizedCart(CART);
    expect(cart.id).toBe('CART-1');
    expect(cart.items).toHaveLength(2);
    expect(cart.items[0]).toMatchObject({ quantity: 2, lineTotal: 3.58 });
    expect(cart.items[0]?.product.id).toBe('91574');
    expect(cart.totals).toMatchObject({ cartAmount: 10.51, orderAmount: 10.51, discountAmount: 0 });
  });
});

describe('aggregateCartNutrition', () => {
  it('sums macros (per-100g × weight × qty), flags incomplete lines, totals the price', () => {
    const agg = aggregateCartNutrition(CART);
    expect(agg.totalPrice).toBe(10.51);
    expect(agg.lineCount).toBe(2);
    expect(agg.incompleteLines).toBe(1); // the weightless line
    // Line 1 only: factor = 0.125 kg × 10 × 2 = 2.5 → kcal 262×2.5=655, protein 13×2.5=32.5.
    expect(agg.nutrition.energyKcal).toBe(655);
    expect(agg.nutrition.protein).toBe(32.5);
  });

  it('reports all lines incomplete when nothing has weight + nutrition', () => {
    const empty: CartContent = { id: 'C', isOrdered: false, amounts: {}, items: [] };
    const agg = aggregateCartNutrition(empty);
    expect(agg.lineCount).toBe(0);
    expect(agg.incompleteLines).toBe(0);
    expect(agg.nutrition).toEqual({});
  });
});
