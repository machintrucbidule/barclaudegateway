import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import type { ScanEvent, ScansResponse } from '@barclaudegateway/shared';
import { api } from '../api/client.js';
import { StatusBadge } from '../components/StatusBadge.js';

interface LogRow {
  key: string;
  at: number;
  status: string;
  ean: string;
  message: string;
}

const MAX_ROWS = 200;

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('fr-FR');
}

type Connection = 'connecting' | 'open' | 'error';

export function LogsPage(): JSX.Element {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const liveCounter = useRef(0);

  useEffect(() => {
    let active = true;

    // Seed with the recent history so the page is not empty before the first live scan.
    void api
      .getScans()
      .then((data: ScansResponse) => {
        if (!active) return;
        setRows((prev) => {
          const history: LogRow[] = data.scans.map((s) => ({
            key: `h-${String(s.id)}`,
            at: s.createdAt,
            status: s.outcome,
            ean: s.ean,
            message: s.message ?? '',
          }));
          // Keep any live rows that arrived before history resolved, newest first.
          return [...prev, ...history].slice(0, MAX_ROWS);
        });
      })
      .catch(() => {
        // A failed preload is non-fatal: the live stream still populates the list.
      });

    const source = new EventSource('/api/scans/stream');
    source.onopen = (): void => {
      if (active) setConnection('open');
    };
    source.onerror = (): void => {
      // EventSource auto-reconnects; surface the gap without tearing anything down.
      if (active) setConnection('error');
    };
    source.onmessage = (event: MessageEvent<string>): void => {
      if (!active) return;
      const scan = JSON.parse(event.data) as ScanEvent;
      liveCounter.current += 1;
      const row: LogRow = {
        key: `l-${String(scan.at)}-${String(liveCounter.current)}`,
        at: scan.at,
        status: scan.response.status,
        ean: scan.response.ean,
        message: scan.response.message ?? '',
      };
      setRows((prev) => [row, ...prev].slice(0, MAX_ROWS));
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
    <Stack maw={840}>
      <Group justify="space-between">
        <Title order={2}>Journal en direct</Title>
        <Badge color={indicator.color} variant="light">
          {indicator.label}
        </Badge>
      </Group>
      <Card withBorder>
        {rows.length === 0 ? (
          <Text c="dimmed" size="sm">
            En attente de scans…
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Heure</Table.Th>
                <Table.Th>EAN</Table.Th>
                <Table.Th>Statut</Table.Th>
                <Table.Th>Message</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.key}>
                  <Table.Td>{formatTime(row.at)}</Table.Td>
                  <Table.Td>{row.ean}</Table.Td>
                  <Table.Td>
                    <StatusBadge status={row.status} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{row.message}</Text>
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
