import type { JSX } from 'react';
import { Badge } from '@mantine/core';
import type { LogCategory, LogLevel } from '@barclaudegateway/shared';

/** French label + Mantine colour for each operational-log category (BL-003, BL-009). */
const CATEGORY: Record<LogCategory, { color: string; label: string }> = {
  auth: { color: 'indigo', label: 'Authentification' },
  scan: { color: 'cyan', label: "Scan d'objet" },
  other: { color: 'gray', label: 'Autre' },
  // BL-009: upstream Chronodrive calls vs inbound local-API requests.
  chronodrive: { color: 'orange', label: 'API Chronodrive' },
  api_local: { color: 'teal', label: 'API interne' },
};

/** French label + colour for each log level. `error` is red so a failing step stands out. */
const LEVEL: Record<LogLevel, { color: string; label: string }> = {
  info: { color: 'gray', label: 'Info' },
  warn: { color: 'yellow', label: 'Attention' },
  error: { color: 'red', label: 'Erreur' },
};

export function CategoryBadge({ category }: { category: LogCategory }): JSX.Element {
  const meta = CATEGORY[category] ?? { color: 'gray', label: category };
  return (
    <Badge color={meta.color} variant="light">
      {meta.label}
    </Badge>
  );
}

export function LevelBadge({ level }: { level: LogLevel }): JSX.Element {
  const meta = LEVEL[level] ?? { color: 'gray', label: level };
  return (
    <Badge color={meta.color} variant="light">
      {meta.label}
    </Badge>
  );
}
