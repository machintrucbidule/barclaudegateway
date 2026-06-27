import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { ScanRecord, ScansResponse } from '@barclaudegateway/shared';
import { api } from '../api/client.js';
import { StatusBadge } from '../components/StatusBadge.js';

/** Page-size options (BL-004); `all` returns every matching row on one page. Default 100. */
const PAGE_SIZES = ['10', '50', '100', '500', 'all'] as const;
const DEFAULT_PAGE_SIZE = '100';

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'added', label: 'Ajouté' },
  { value: 'added_to_lists_only', label: 'Listes seulement' },
  { value: 'not_found', label: 'Introuvable' },
  { value: 'partial', label: 'Partiel' },
  { value: 'error', label: 'Erreur' },
  { value: 'invalid_ean', label: 'Code invalide' },
];

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('fr-FR');
}

/**
 * Scan history (BL-004): a searchable, filterable, paginated history of scanned codes and each code's
 * status. Unlike the operational-logs page, it is NOT live — a new scan does not auto-append; the user
 * searches, filters, and paginates. Backed by `GET /api/scans` with status/search/page/pageSize params.
 */
export function ScanHistoryPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [pageSize, setPageSize] = useState<string>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ScansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getScans({
        page,
        pageSize: pageSize === 'all' ? 'all' : Number(pageSize),
        ...(status ? { status } : {}),
        ...(search ? { search } : {}),
      })
      .then((response) => {
        if (!active) return;
        setData(response);
        setError(null);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Chargement impossible');
      });
    return () => {
      active = false;
    };
  }, [page, pageSize, status, search]);

  const total = data?.total ?? 0;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / Number(pageSize)));

  return (
    <Stack maw={960}>
      <Title order={2}>Historique des scans</Title>

      <Group align="flex-end">
        <TextInput
          label="Recherche (EAN ou message)"
          placeholder="ex. 3017620..."
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          w={260}
        />
        <Select
          label="Statut"
          data={STATUS_OPTIONS}
          value={status}
          onChange={(value) => {
            setStatus(value ?? '');
            setPage(1);
          }}
          w={200}
          allowDeselect={false}
        />
        <Select
          label="Par page"
          data={PAGE_SIZES.map((s) => ({ value: s, label: s === 'all' ? 'Tout' : s }))}
          value={pageSize}
          onChange={(value) => {
            setPageSize(value ?? DEFAULT_PAGE_SIZE);
            setPage(1);
          }}
          w={120}
          allowDeselect={false}
        />
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {data === null ? (
        <Loader />
      ) : (
        <Card withBorder>
          <Stack>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {total} scan(s) {status || search ? 'correspondant(s)' : 'au total'}
              </Text>
              {pageSize !== 'all' && (
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => Math.max(1, p - 1));
                    }}
                  >
                    Précédent
                  </Button>
                  <Text size="sm">
                    Page {page} / {totalPages}
                  </Text>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={page >= totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
                    }}
                  >
                    Suivant
                  </Button>
                </Group>
              )}
            </Group>

            {data.scans.length === 0 ? (
              <Text c="dimmed" size="sm">
                Aucun scan ne correspond.
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
                  {data.scans.map((scan: ScanRecord) => (
                    <Table.Tr key={scan.id}>
                      <Table.Td>{formatTime(scan.createdAt)}</Table.Td>
                      <Table.Td>{scan.ean}</Table.Td>
                      <Table.Td>
                        <StatusBadge status={scan.outcome} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{scan.message}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
