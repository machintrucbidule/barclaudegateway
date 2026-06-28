import { describe, expect, it } from 'vitest';
import type { Product } from '@barclaudegateway/shared';
import {
  STATIC_MEDIA_BASE,
  mapNutrition,
  toAbsoluteImages,
  toNormalizedProduct,
  toProductSummary,
} from './productMapper.js';

/** Captured sample 91574 (contract.md §5.12 / §5.12.1) — mozzarella, no fibre declared. */
const PRODUCT_91574: Product = {
  id: '91574',
  labels: {
    productLabel: 'Mozzarella di bufala campana AOP',
    brandLabel: 'AUCHAN',
    unitQuantityLabel: '125 g',
  },
  eans: ['3596710335510'],
  prices: {
    defaultPrice: 1.79,
    pricePerUnitMeasure: 14.32,
    lastPeriodLowestPrice: 1.79,
    vatRate: 5.5,
  },
  stock: 'HIGH_STOCK',
  remainingStock: 228,
  isEligible: true,
  packaging: { unit: 'kg', unitMeasure: 0.125, weight: 0.125 },
  images: {
    thumbnails: ['img/PM/V/0/74/0V_91574.gif'],
    views: ['img/PM/P/0/74/0P_91574.gif'],
    zooms: ['img/PM/Z/0/74/0Z_91574.jpg'],
  },
  characteristics: {
    origin: '',
    ingredients: 'Ingrédients : LAIT de bufflonne pasteurisé, sel, présure.',
    allergens: [],
    features: [
      { code: '563', value: '100 g' },
      { code: '157', value: '1084' },
      { code: '243', value: '262' },
      { code: '159', value: '23' },
      { code: '160', value: '16' },
      { code: '163', value: '0.700' },
      { code: '164', value: '0.700' },
      { code: '168', value: '13' },
      { code: '169', value: '0.570' },
      { code: '520', value: 'C' },
      { code: '383', value: 'Contient : Lait' },
      { code: '759', value: 'ITALIE pour AUCHAN SAS OIA' },
      { code: '351', value: 'AUCHAN' }, // unmapped label code — must be ignored
      { code: '999', value: true }, // boolean flag — must be ignored
    ],
  },
};

/** Captured sample 572811 (contract.md §5.12.1) — fibre present, different Nutri-Score. */
const PRODUCT_572811: Product = {
  id: '572811',
  labels: { productLabel: 'Pain', brandLabel: 'BRAND' },
  eans: ['1234567890123'],
  packaging: { unit: 'kg', weight: 0.1 },
  characteristics: {
    features: [
      { code: '563', value: '100 g' },
      { code: '157', value: '2114' },
      { code: '243', value: '506' },
      { code: '159', value: '27' },
      { code: '160', value: '5.4' },
      { code: '163', value: '50' },
      { code: '164', value: '6.3' },
      { code: '167', value: '5.5' },
      { code: '168', value: '13' },
      { code: '169', value: '1.8' },
      { code: '520', value: 'D' },
      { code: '383', value: 'BLÉ, GLUTEN, LAIT, ŒUF' },
      { code: '759', value: 'FRANCE' },
    ],
  },
};

describe('mapNutrition (§5.12.1)', () => {
  it('maps the essential set for sample 91574 and omits undeclared fibre', () => {
    const n = mapNutrition(PRODUCT_91574.characteristics?.features);
    expect(n).toEqual({
      base: '100 g',
      energyKj: 1084,
      energyKcal: 262,
      fat: 23,
      saturates: 16,
      carbohydrate: 0.7,
      sugars: 0.7,
      protein: 13,
      salt: 0.57,
      nutriScore: 'C',
      allergens: 'Contient : Lait',
      origin: 'ITALIE pour AUCHAN SAS OIA',
    });
    expect(n).not.toHaveProperty('fibre'); // not declared on this product
  });

  it('maps fibre + the different grade for sample 572811', () => {
    const n = mapNutrition(PRODUCT_572811.characteristics?.features);
    expect(n.energyKcal).toBe(506);
    expect(n.fibre).toBe(5.5);
    expect(n.saturates).toBe(5.4);
    expect(n.nutriScore).toBe('D');
    expect(n.salt).toBe(1.8);
    expect(n.allergens).toBe('BLÉ, GLUTEN, LAIT, ŒUF');
  });

  it('returns an empty object when there are no features', () => {
    expect(mapNutrition()).toEqual({});
  });
});

describe('toAbsoluteImages', () => {
  it('prefixes relative paths with the static media host and defaults missing kinds to []', () => {
    const imgs = toAbsoluteImages(PRODUCT_91574.images);
    expect(imgs.views[0]).toBe(`${STATIC_MEDIA_BASE}img/PM/P/0/74/0P_91574.gif`);
    expect(imgs.zooms[0]).toBe(`${STATIC_MEDIA_BASE}img/PM/Z/0/74/0Z_91574.jpg`);
    expect(toAbsoluteImages({}).views).toEqual([]);
  });
});

describe('toNormalizedProduct / toProductSummary', () => {
  it('normalizes the full product sheet (identity, weight, price, nutrition, images)', () => {
    const p = toNormalizedProduct(PRODUCT_91574);
    expect(p.id).toBe('91574');
    expect(p.eans).toEqual(['3596710335510']);
    expect(p.name).toBe('Mozzarella di bufala campana AOP');
    expect(p.weightKg).toBe(0.125);
    expect(p.price).toEqual({
      default: 1.79,
      perUnitMeasure: 14.32,
      lastPeriodLowest: 1.79,
      vatRate: 5.5,
    });
    expect(p.nutrition.energyKcal).toBe(262);
    expect(p.nutrition.protein).toBe(13);
    expect(p.ingredients).toContain('LAIT');
    expect(p.images.views[0]).toBe(`${STATIC_MEDIA_BASE}img/PM/P/0/74/0P_91574.gif`);
  });

  it('produces a lean summary with a single representative image, no nutrition', () => {
    const s = toProductSummary(PRODUCT_91574);
    expect(s.id).toBe('91574');
    expect(s.weightKg).toBe(0.125);
    expect(s.image).toBe(`${STATIC_MEDIA_BASE}img/PM/P/0/74/0P_91574.gif`);
    expect(s).not.toHaveProperty('nutrition');
    expect(s).not.toHaveProperty('images');
  });
});
