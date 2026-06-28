/**
 * Map an upstream Chronodrive cart (contract.md §5.3 non-empty schema) into the normalized Layer-B cart
 * DTOs (BL-011): the current-cart view and the budget + nutrition aggregate (UC10). Pure functions —
 * unit-tested against a populated-cart fixture.
 *
 * A single `GET /v1/customers/me/carts?withCoupons=true` already carries each line's full product sheet
 * (incl. nutrition `features`), the per-line total, and the cart-level `amounts`, so both views are built
 * from one response with no extra calls.
 */

import type {
  CartNutritionAggregate,
  CartTotals,
  NormalizedCart,
  NormalizedCartLine,
  ProductNutrition,
} from '@barclaudegateway/shared';
import type { ActiveCartResponse, CartLineItem } from '@barclaudegateway/shared';
import { mapNutrition, toProductSummary } from './productMapper.js';

type CartContent = ActiveCartResponse['content'][number];

/** Round to 2 decimals to keep summed macros free of float noise. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The numeric macro fields that can be summed across lines (text/grade fields are not aggregatable). */
const MACRO_KEYS = [
  'energyKj',
  'energyKcal',
  'fat',
  'saturates',
  'carbohydrate',
  'sugars',
  'fibre',
  'protein',
  'salt',
] as const satisfies ReadonlyArray<keyof ProductNutrition>;

/** Project one upstream cart line to a normalized line (skips the rare line with no product). */
function toLine(line: CartLineItem): NormalizedCartLine | undefined {
  if (!line.product) return undefined;
  return {
    quantity: line.quantity,
    product: toProductSummary(line.product),
    ...(line.product.prices?.totalAmount !== undefined
      ? { lineTotal: line.product.prices.totalAmount }
      : {}),
  };
}

/** §5.3 — the current cart (line items + budget totals). */
export function toNormalizedCart(cart: CartContent): NormalizedCart {
  const a = cart.amounts ?? {};
  const totals: CartTotals = {
    cartAmount: a.totalCartAmount,
    orderAmount: a.totalOrderAmount,
    discountAmount: a.totalDiscountAmount,
    depositAmount: a.totalDepositAmount,
    loyaltyEarned: a.totalLoyaltyEarnedAmount,
  };
  return {
    id: cart.id,
    items: cart.items.map(toLine).filter((l): l is NormalizedCartLine => l !== undefined),
    totals,
  };
}

/**
 * UC10 — budget + nutrition aggregate. `totalPrice` is the authoritative cart total; macros are summed as
 * `per-100g × (weightKg × 10) × quantity`. A line lacking a net weight or any declared macro is counted in
 * `incompleteLines` and excluded from the macro sum.
 */
export function aggregateCartNutrition(cart: CartContent): CartNutritionAggregate {
  const sum: Record<string, number> = {};
  let incompleteLines = 0;

  for (const line of cart.items) {
    const product = line.product;
    const weightKg = product?.packaging?.weight;
    const nutrition = product ? mapNutrition(product.characteristics?.features) : {};
    const hasMacro = MACRO_KEYS.some((k) => typeof nutrition[k] === 'number');
    if (weightKg === undefined || !hasMacro) {
      incompleteLines += 1;
      continue;
    }
    const factor = weightKg * 10 * line.quantity; // per-100g → grams in the package × quantity
    for (const k of MACRO_KEYS) {
      const v = nutrition[k];
      if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v * factor;
    }
  }

  const nutrition: ProductNutrition = {};
  for (const k of MACRO_KEYS) {
    if (sum[k] !== undefined) nutrition[k] = round2(sum[k]);
  }

  return {
    totalPrice: cart.amounts?.totalCartAmount,
    lineCount: cart.items.length,
    incompleteLines,
    nutrition,
  };
}
