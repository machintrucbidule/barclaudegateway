import type { JSX } from 'react';
import { Badge } from '@mantine/core';

/** Colour + French label for each scan outcome, shared by the dashboard table and the live log. */
const STATUS: Record<string, { color: string; label: string }> = {
  added: { color: 'green', label: 'Ajouté' },
  added_to_lists_only: { color: 'teal', label: 'Listes seulement' },
  duplicate_ignored: { color: 'gray', label: 'Doublon ignoré' },
  not_found: { color: 'orange', label: 'Introuvable' },
  partial: { color: 'yellow', label: 'Partiel' },
  error: { color: 'red', label: 'Erreur' },
  invalid_ean: { color: 'red', label: 'Code invalide' },
};

export function StatusBadge({ status }: { status: string }): JSX.Element {
  const meta = STATUS[status] ?? { color: 'gray', label: status };
  return (
    <Badge color={meta.color} variant="light">
      {meta.label}
    </Badge>
  );
}
