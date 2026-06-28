/**
 * Map upstream Chronodrive products (contract.md §5.12/§5.12.1) into the normalized Layer-B DTOs the
 * local API exposes (BL-010). Pure functions — no I/O — so they are exhaustively unit-tested against the
 * two captured product samples.
 *
 * The nutrition map is the **essential set only** (§5.12.1, DECISION-022): the ~50 boolean/label feature
 * codes are intentionally not mapped. A nutrient is absent from the output when the manufacturer did not
 * declare it (the feature code is missing upstream).
 */

import type {
  NormalizedProduct,
  ProductImageUrls,
  ProductNutrition,
  ProductPrice,
  ProductSummary,
} from '@barclaudegateway/shared';
import type { Product, ProductFeature, ProductImages } from '@barclaudegateway/shared';

/** Static media host (contract.md §1): relative image paths are prefixed with this. */
export const STATIC_MEDIA_BASE = 'https://static1.chronodrive.com/';

/** Essential nutrition feature codes (§5.12.1). */
const NUTRITION_CODE = {
  base: '563',
  energyKj: '157',
  energyKcal: '243',
  fat: '159',
  saturates: '160',
  carbohydrate: '163',
  sugars: '164',
  fibre: '167',
  protein: '168',
  salt: '169',
  nutriScore: '520',
  allergens: '383',
  origin: '759',
} as const;

/** Parse a feature value to a number, tolerating a string ("0.700") and rejecting NaN/non-strings. */
function toNumber(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const n = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Keep a feature value only when it is a non-empty string (for text fields like origin/allergens). */
function toText(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** §5.12.1 — translate `characteristics.features[]` into the essential normalized nutrition object. */
export function mapNutrition(features: ProductFeature[] = []): ProductNutrition {
  const byCode = new Map<string, string | boolean>();
  for (const f of features) byCode.set(f.code, f.value);
  const v = (code: string): string | boolean | undefined => byCode.get(code);

  const nutrition: ProductNutrition = {
    base: toText(v(NUTRITION_CODE.base)),
    energyKj: toNumber(v(NUTRITION_CODE.energyKj)),
    energyKcal: toNumber(v(NUTRITION_CODE.energyKcal)),
    fat: toNumber(v(NUTRITION_CODE.fat)),
    saturates: toNumber(v(NUTRITION_CODE.saturates)),
    carbohydrate: toNumber(v(NUTRITION_CODE.carbohydrate)),
    sugars: toNumber(v(NUTRITION_CODE.sugars)),
    fibre: toNumber(v(NUTRITION_CODE.fibre)),
    protein: toNumber(v(NUTRITION_CODE.protein)),
    salt: toNumber(v(NUTRITION_CODE.salt)),
    nutriScore: toText(v(NUTRITION_CODE.nutriScore)),
    allergens: toText(v(NUTRITION_CODE.allergens)),
    origin: toText(v(NUTRITION_CODE.origin)),
  };
  // Drop undefined keys so the JSON only carries declared nutrients.
  return Object.fromEntries(
    Object.entries(nutrition).filter(([, value]) => value !== undefined),
  ) as ProductNutrition;
}

/** Prefix a relative image path with the static media host; pass through already-absolute URLs. */
function toAbsolute(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${STATIC_MEDIA_BASE}${path}`;
}

/** §5.12 images → absolute URLs (each kind defaults to an empty array). */
export function toAbsoluteImages(images: ProductImages = {}): ProductImageUrls {
  const map = (paths: string[] | undefined): string[] => (paths ?? []).map(toAbsolute);
  return { thumbnails: map(images.thumbnails), views: map(images.views), zooms: map(images.zooms) };
}

/** Shared identity/price/availability projection. */
function mapPrice(p: Product): ProductPrice {
  return {
    default: p.prices?.defaultPrice,
    perUnitMeasure: p.prices?.pricePerUnitMeasure,
    lastPeriodLowest: p.prices?.lastPeriodLowestPrice,
    vatRate: p.prices?.vatRate,
  };
}

/** Full normalized product sheet (`GET /api/v1/products/{eanOrId}`). */
export function toNormalizedProduct(p: Product): NormalizedProduct {
  return {
    id: p.id,
    eans: p.eans ?? [],
    name: p.labels?.productLabel,
    brand: p.labels?.brandLabel,
    unitQuantityLabel: p.labels?.unitQuantityLabel,
    weightKg: p.packaging?.weight,
    price: mapPrice(p),
    stock: p.stock,
    remainingStock: p.remainingStock,
    isEligible: p.isEligible,
    nutrition: mapNutrition(p.characteristics?.features),
    ingredients: p.characteristics?.ingredients,
    images: toAbsoluteImages(p.images),
  };
}

/** Lean search-result item (`GET /api/v1/search?q=`). */
export function toProductSummary(p: Product): ProductSummary {
  const images = toAbsoluteImages(p.images);
  const image = images.views[0] ?? images.thumbnails[0];
  return {
    id: p.id,
    eans: p.eans ?? [],
    name: p.labels?.productLabel,
    brand: p.labels?.brandLabel,
    unitQuantityLabel: p.labels?.unitQuantityLabel,
    weightKg: p.packaging?.weight,
    price: mapPrice(p),
    stock: p.stock,
    remainingStock: p.remainingStock,
    isEligible: p.isEligible,
    ...(image !== undefined ? { image } : {}),
  };
}
