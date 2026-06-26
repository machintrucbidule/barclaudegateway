/**
 * Maintenance page (Phase 5, CLARIFY-06).
 *
 * Two always-useful halves:
 *  - the live critical-error state, explained in plain French (or a calm "all good" panel when the
 *    surface has auto-cleared);
 *  - the long-term maintenance toolkit: a Firefox HAR capture tutorial and a ready-to-paste Claude
 *    debug prompt, prefilled with the observed error context, so a breakage can be diagnosed against
 *    the documented contract (contract.md §7.2) without reading logs.
 */

import type { JSX } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  List,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { ErrorStateError } from '@barclaudegateway/shared';
import { useErrorState } from '../hooks/useErrorState.js';
import { errorCategoryLabel } from '../components/errorCategory.js';

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('fr-FR');
}

/** Build the ready-to-paste Claude debug prompt, embedding the observed error context (or placeholders). */
function buildDebugPrompt(error: ErrorStateError | undefined): string {
  const category = error
    ? `${errorCategoryLabel(error.category).label} (${error.category})`
    : '(catégorie de l’erreur)';
  const endpoint = error?.endpoint ?? '(endpoint concerné)';
  const message = error?.message ?? '(message d’erreur observé)';
  const apiVersion = error?.apiVersion ?? '(version x-api-version observée)';
  const timestamp = error ? formatTime(error.at) : '(horodatage)';

  return [
    "Je maintiens BarclaudeGateway, un middleware qui relie un scanner ESP32 à l'API privée non documentée de Chronodrive. Une erreur critique vient de se produire et je dois la diagnostiquer.",
    '',
    "Contexte de l'erreur observée :",
    `- Catégorie : ${category}`,
    `- Endpoint concerné : ${endpoint}`,
    `- Message : ${message}`,
    `- Version d'API Chronodrive (x-api-version) : ${apiVersion}`,
    `- Horodatage : ${timestamp}`,
    '',
    "Je te fournis ci-joint une capture réseau HAR (export Firefox) du parcours qui échoue, dépouillée de ses valeurs sensibles. Compare-la au contrat documenté dans specifications/api/chronodrive/contract.md : identifie précisément ce qui a changé (URL, méthode, en-têtes requis, forme du corps de requête ou de réponse), puis propose d'abord la correction du contrat (en suivant son processus §7.2), puis la correction du code du middleware.",
  ].join('\n');
}

function ActiveErrorPanel({ error }: { error: ErrorStateError }): JSX.Element {
  const meta = errorCategoryLabel(error.category);
  return (
    <Alert color="red" title="Une panne est en cours">
      <Stack gap="xs">
        <Group gap="xs">
          <Badge color={meta.color} variant="filled">
            {meta.label}
          </Badge>
          <Text size="sm" c="dimmed">
            détectée le {formatTime(error.at)}
          </Text>
        </Group>
        <Text size="sm">{meta.explanation}</Text>
        <Text size="sm">
          <Text span fw={600}>
            Endpoint&nbsp;:
          </Text>{' '}
          {error.endpoint ?? 'non précisé'}
        </Text>
        <Text size="sm">
          <Text span fw={600}>
            Message&nbsp;:
          </Text>{' '}
          {error.message}
        </Text>
        {error.apiVersion && (
          <Text size="sm">
            <Text span fw={600}>
              Version d&apos;API (x-api-version)&nbsp;:
            </Text>{' '}
            {error.apiVersion}
          </Text>
        )}
      </Stack>
    </Alert>
  );
}

function HarTutorial(): JSX.Element {
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Capturer une trace réseau (HAR) avec Firefox</Title>
        <Text size="sm" c="dimmed">
          Quand l&apos;API Chronodrive change sans prévenir, une capture HAR du parcours qui échoue
          permet de comparer ce qui se passe réellement au contrat documenté.
        </Text>
        <List type="ordered" size="sm" spacing="xs">
          <List.Item>Ouvrez Firefox sur la page Chronodrive concernée.</List.Item>
          <List.Item>
            Appuyez sur <Code>F12</Code> pour ouvrir les outils de développement, puis l&apos;onglet
            «&nbsp;Réseau&nbsp;».
          </List.Item>
          <List.Item>
            Activez «&nbsp;Persister les journaux&nbsp;» (Persist Logs) pour conserver les requêtes
            entre les changements de page.
          </List.Item>
          <List.Item>
            Reproduisez l&apos;action qui échoue (connexion, recherche d&apos;un produit, ajout au
            panier…).
          </List.Item>
          <List.Item>
            Clic droit dans la liste des requêtes → «&nbsp;Tout enregistrer comme HAR&nbsp;» (Save
            All As HAR).
          </List.Item>
          <List.Item>
            <Text span fw={600} c="red">
              ⚠️ Avant de partager le fichier
            </Text>
            , retirez les valeurs sensibles&nbsp;: l&apos;en-tête <Code>Authorization</Code>, le
            cookie <Code>chronosession</Code> et le corps des appels d&apos;authentification (voir
            contract.md §8).
          </List.Item>
          <List.Item>
            Copiez le prompt ci-dessous, joignez le fichier HAR nettoyé, et envoyez le tout à
            Claude.
          </List.Item>
        </List>
      </Stack>
    </Card>
  );
}

function DebugPromptCard({ prompt }: { prompt: string }): JSX.Element {
  return (
    <Card withBorder>
      <Stack>
        <Group justify="space-between">
          <Title order={4}>Prompt de diagnostic prêt à copier</Title>
          <CopyButton value={prompt}>
            {({ copied, copy }) => (
              <Button color={copied ? 'teal' : 'blue'} onClick={copy}>
                {copied ? 'Copié' : 'Copier le prompt'}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Code block>{prompt}</Code>
      </Stack>
    </Card>
  );
}

export function MaintenancePage(): JSX.Element {
  const state = useErrorState();
  const prompt = buildDebugPrompt(state.error);

  return (
    <Stack maw={840}>
      <Title order={2}>Maintenance</Title>
      {state.active && state.error ? (
        <ActiveErrorPanel error={state.error} />
      ) : (
        <Alert color="green" title="Aucune panne en cours">
          Tout fonctionne&nbsp;: aucune erreur critique n&apos;est détectée côté Chronodrive. Le
          tutoriel ci-dessous reste disponible pour la prochaine fois.
        </Alert>
      )}
      <HarTutorial />
      <DebugPromptCard prompt={prompt} />
    </Stack>
  );
}
