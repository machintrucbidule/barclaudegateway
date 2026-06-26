/**
 * Plain-French names and explanations for each {@link ErrorCategory} (Phase 5).
 *
 * Shared by the maintenance banner (short label) and the maintenance page (label + what it means in
 * practice). Reuses the existing taxonomy — it does not invent new categories.
 */

import type { ErrorCategory } from '@barclaudegateway/shared';

export interface ErrorCategoryLabel {
  /** Short French name for badges/banners. */
  label: string;
  /** One or two plain sentences: what broke and what to do, no jargon. */
  explanation: string;
  /** Mantine colour for the badge. */
  color: string;
}

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, ErrorCategoryLabel> = {
  auth: {
    label: 'Authentification',
    explanation:
      "La connexion à Chronodrive a échoué (session expirée ou identifiants refusés). Le scanner ne peut plus rien envoyer tant que ce n'est pas rétabli.",
    color: 'red',
  },
  api_key: {
    label: "Clé d'accès",
    explanation:
      "Une des clés d'accès (x-api-key) a été refusée — Chronodrive l'a probablement changée. Il faut récupérer la nouvelle valeur et la mettre à jour dans la configuration.",
    color: 'red',
  },
  schema: {
    label: 'Format de réponse',
    explanation:
      "Chronodrive a répondu, mais dans un format inattendu : l'API a sans doute changé. C'est le cas typique à diagnostiquer avec une capture HAR.",
    color: 'red',
  },
  server: {
    label: 'Erreur serveur',
    explanation:
      'Chronodrive a renvoyé une erreur de leur côté (5xx). Souvent temporaire, mais à surveiller si cela se répète.',
    color: 'red',
  },
  network: {
    label: 'Réseau',
    explanation:
      'Impossible de joindre Chronodrive (connexion refusée, coupée, ou DNS). Vérifiez la connexion réseau de la passerelle.',
    color: 'red',
  },
  timeout: {
    label: 'Délai dépassé',
    explanation:
      "Chronodrive a mis trop de temps à répondre. Souvent temporaire ; si cela persiste, c'est un problème côté Chronodrive ou réseau.",
    color: 'red',
  },
  rate_limit: {
    label: 'Trop de requêtes',
    explanation:
      "Chronodrive limite temporairement le débit (429). Rien n'est cassé ; cela se résorbe généralement seul — ce cas ne déclenche pas d'alerte.",
    color: 'yellow',
  },
  not_found: {
    label: 'Produit introuvable',
    explanation:
      "L'EAN scanné n'existe pas dans le catalogue Chronodrive. C'est un résultat normal, pas une panne — il apparaît sur le tableau de bord et ne déclenche pas d'alerte.",
    color: 'orange',
  },
  unknown: {
    label: 'Erreur inconnue',
    explanation:
      "Une erreur non classée s'est produite. La capture HAR ci-dessous aidera à en déterminer la cause.",
    color: 'gray',
  },
};

/** Look up a category label, falling back to the `unknown` entry for any unexpected value. */
export function errorCategoryLabel(
  category: ErrorCategory | string | undefined,
): ErrorCategoryLabel {
  if (category !== undefined && category in ERROR_CATEGORY_LABELS) {
    return ERROR_CATEGORY_LABELS[category as ErrorCategory];
  }
  return ERROR_CATEGORY_LABELS.unknown;
}
