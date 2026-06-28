import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Card, Group, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core';
import type { EventsResponse, LogCategory, LogEvent } from '@barclaudegateway/shared';
import { api } from '../api/client.js';
import { CategoryBadge, LevelBadge } from '../components/logEvent.js';

/** The category filter value: a real {@link LogCategory} or `all`. */
type Filter = LogCategory | 'all';

const MAX_ROWS = 300;
const SEED_PAGE_SIZE = 200;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'auth', label: 'Authentification' },
  { value: 'scan', label: "Scan d'objet" },
  { value: 'chronodrive', label: 'API Chronodrive' },
  { value: 'api_local', label: 'API interne' },
  { value: 'other', label: 'Autre' },
];

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('fr-FR');
}

type Connection = 'connecting' | 'open' | 'error';

/**
 * Operational logs (BL-003): a live-tailing table of the system's internal events — Chronodrive auth
 * exchanges, the per-step detail of each scan, token refreshes, and system events — filterable by area
 * (Authentification / Scan d'objet / Autre / Tous), with failing steps shown in red. The page seeds from
 * `GET /api/events` then tails `GET /api/events/stream` (SSE); the filter both reseeds and gates the
 * live append.
 */
export function LogsPage(): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<LogEvent[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  // The latest filter, read inside the (once-mounted) SSE handler without re-subscribing.
  const filterRef = useRef<Filter>('all');
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  // Reseed the table whenever the filter changes (the live stream below carries every category). The
  // rows are cleared in the filter change handler; here we just fetch and merge.
  useEffect(() => {
    let active = true;
    void api
      .getEvents({ pageSize: SEED_PAGE_SIZE, ...(filter === 'all' ? {} : { category: filter }) })
      .then((data: EventsResponse) => {
        if (!active) return;
        // Merge with any live events that arrived while the seed was in flight (dedupe by id), so a
        // fast scan during a filter switch is not clobbered by the slower seed response. Newest first.
        setRows((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const merged = [...prev, ...data.events.filter((e) => !seen.has(e.id))];
          return merged.sort((a, b) => b.at - a.at).slice(0, MAX_ROWS);
        });
      })
      .catch(() => {
        // A failed preload is non-fatal: the live stream still populates the list.
      });
    return () => {
      active = false;
    };
  }, [filter]);

  // One SSE subscription for the page lifetime; the handler filters by the current category.
  useEffect(() => {
    let active = true;
    const source = new EventSource('/api/events/stream');
    source.onopen = (): void => {
      if (active) setConnection('open');
    };
    source.onerror = (): void => {
      if (active) setConnection('error');
    };
    source.onmessage = (event: MessageEvent<string>): void => {
      if (!active) return;
      const logEvent = JSON.parse(event.data) as LogEvent;
      const current = filterRef.current;
      if (current !== 'all' && logEvent.category !== current) return;
      setRows((prev) => [logEvent, ...prev].slice(0, MAX_ROWS));
    };
    return () => {
      active = false;
      source.close();
    };
  }, []);

  const indicator =
    connection === 'open'
      ? { color: 'green', label: 'connecté' }
      : connection === 'connecting'
        ? { color: 'gray', label: 'connexion…' }
        : { color: 'red', label: 'reconnexion…' };

  return (
    <Stack maw={960}>
      <Group justify="space-between">
        <Title order={2}>Logs techniques</Title>
        <Badge color={indicator.color} variant="light">
          {indicator.label}
        </Badge>
      </Group>

      <SegmentedControl
        data={FILTERS}
        value={filter}
        onChange={(value) => {
          setFilter(value as Filter);
          // Drop the previous category's rows immediately; the effect reseeds for the new filter.
          setRows([]);
        }}
      />

      <Card withBorder>
        {rows.length === 0 ? (
          <Text c="dimmed" size="sm">
            En attente d'événements…
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Heure</Table.Th>
                <Table.Th>Catégorie</Table.Th>
                <Table.Th>Étape</Table.Th>
                <Table.Th>Niveau</Table.Th>
                <Table.Th>Message</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>{formatTime(row.at)}</Table.Td>
                  <Table.Td>
                    <CategoryBadge category={row.category} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {row.type}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <LevelBadge level={row.level} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={row.level === 'error' ? 'red' : undefined}>
                      {row.message}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
