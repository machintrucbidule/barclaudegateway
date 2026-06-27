import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import type { HealthReport, ScanRecord, ScansResponse } from '@barclaudegateway/shared';
import { api } from '../api/client.js';
import { StatusBadge } from '../components/StatusBadge.js';

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('fr-FR');
}

/** Shown before any credentials are saved: an informational call-to-action, not an error. */
function NotConfiguredCard(): JSX.Element {
  return (
    <Alert color="blue" title="Chronodrive n'est pas encore configuré">
      Aucune connexion n'est tentée tant que vos identifiants ne sont pas renseignés. Ouvrez la{' '}
      <Anchor component={Link} to="/config" fw={600}>
        page Configuration
      </Anchor>{' '}
      pour saisir votre e-mail et votre mot de passe Chronodrive.
    </Alert>
  );
}

function HealthCard({ health }: { health: HealthReport }): JSX.Element {
  // The customer-profile probe doubles as the session/token signal: it only succeeds with a live token.
  const session = health.checks.find((c) => c.endpoint === 'GET /customers/me');
  return (
    <Card withBorder>
      <Stack>
        <Group justify="space-between">
          <Title order={4}>État de santé</Title>
          <Badge color={health.ok ? 'green' : 'red'} variant="filled">
            {health.ok ? 'Opérationnel' : 'Dégradé'}
          </Badge>
        </Group>
        <Group>
          <Text size="sm">
            Session / jeton&nbsp;:{' '}
            <Text span fw={600} c={session?.status === 'ok' ? 'green' : 'red'}>
              {session ? (session.status === 'ok' ? 'actif' : 'inactif') : 'inconnu'}
            </Text>
          </Text>
          {health.siteId && (
            <Text size="sm" c="dimmed">
              Magasin&nbsp;: {health.siteId}
            </Text>
          )}
        </Group>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Vérification</Table.Th>
              <Table.Th>Statut</Table.Th>
              <Table.Th>Détail</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {health.checks.map((check) => (
              <Table.Tr key={check.endpoint}>
                <Table.Td>{check.name}</Table.Td>
                <Table.Td>
                  <Badge color={check.status === 'ok' ? 'green' : 'red'} variant="light">
                    {check.status === 'ok' ? 'ok' : 'erreur'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {check.detail}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}

function RecentScans({ data }: { data: ScansResponse }): JSX.Element {
  const notFound = data.scans.filter((s) => s.outcome === 'not_found');
  return (
    <Card withBorder>
      <Stack>
        <Group justify="space-between">
          <Title order={4}>Derniers scans</Title>
          <Text size="sm" c="dimmed">
            {data.total} scan(s) au total
          </Text>
        </Group>

        {notFound.length > 0 && (
          <Alert color="orange" title="Produits introuvables">
            {notFound.length} scan(s) récent(s) sans correspondance dans le catalogue Chronodrive
            (EAN&nbsp;: {notFound.map((s) => s.ean).join(', ')}).
          </Alert>
        )}

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
      </Stack>
    </Card>
  );
}

export function DashboardPage(): JSX.Element {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [scans, setScans] = useState<ScansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const [h, s] = await Promise.all([api.getHealth(), api.getScans()]);
        if (!active) return;
        setHealth(h);
        setScans(s);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Chargement impossible');
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Stack maw={840}>
      <Title order={2}>Tableau de bord</Title>
      {error && <Alert color="red">{error}</Alert>}
      {health ? (
        health.configured === false ? (
          <NotConfiguredCard />
        ) : (
          <HealthCard health={health} />
        )
      ) : (
        <Loader />
      )}
      {scans ? <RecentScans data={scans} /> : <Loader />}
    </Stack>
  );
}
