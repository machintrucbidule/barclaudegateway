import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { PriceTrackingSettings, TrackedProduct } from '@barclaudegateway/shared';
import { api, ApiError } from '../api/client.js';

function formatTime(epochMs?: number): string {
  return epochMs === undefined ? '—' : new Date(epochMs).toLocaleString('fr-FR');
}

function euro(value?: number): string {
  return value === undefined ? '—' : `${value.toFixed(2)} €`;
}

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Erreur';
}

/**
 * Suivi des prix (BL-012): manage the products under price tracking — list them with their current price
 * and threshold, add one by EAN, edit a threshold, remove tracking, and arm the gated scheduler (with a
 * "vérifier maintenant" button). Talks to the internal `/api/price-tracking/*` surface.
 */
export function PriceTrackingPage(): JSX.Element {
  const [products, setProducts] = useState<TrackedProduct[]>([]);
  const [settings, setSettings] = useState<PriceTrackingSettings>({
    enabled: false,
    intervalHours: 12,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    const [list, s] = await Promise.all([api.getTrackedProducts(), api.getPriceSettings()]);
    setProducts(list.products);
    setSettings(s);
  };

  useEffect(() => {
    let active = true;
    void (async (): Promise<void> => {
      try {
        await reload();
      } catch (e) {
        if (active) setError(message(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <Loader />;

  return (
    <Stack maw={1000}>
      <Title order={2}>Suivi des prix</Title>
      {error && <Alert color="red">{error}</Alert>}
      <SettingsSection settings={settings} onSaved={setSettings} onError={setError} />
      <AddSection
        onAdded={() => void reload().catch((e: unknown) => setError(message(e)))}
        onError={setError}
      />
      <TrackedTable
        products={products}
        onChanged={() => void reload().catch((e: unknown) => setError(message(e)))}
        onError={setError}
      />
    </Stack>
  );
}

function SettingsSection({
  settings,
  onSaved,
  onError,
}: {
  settings: PriceTrackingSettings;
  onSaved: (s: PriceTrackingSettings) => void;
  onError: (e: string) => void;
}): JSX.Element {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [intervalHours, setIntervalHours] = useState<number>(settings.intervalHours);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    try {
      const next = await api.putPriceSettings({ enabled, intervalHours });
      onSaved(next);
      setSaved(true);
    } catch (e) {
      onError(message(e));
    } finally {
      setSaving(false);
    }
  };

  const checkNow = async (): Promise<void> => {
    setCheckResult(null);
    try {
      const r = await api.checkPricesNow();
      setCheckResult(`${String(r.checked)} produit(s) vérifié(s), ${String(r.alerts)} alerte(s).`);
    } catch (e) {
      onError(message(e));
    }
  };

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Title order={4}>Réglages</Title>
        <Switch
          label="Activer le suivi automatique des prix"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.currentTarget.checked);
            setSaved(false);
          }}
        />
        <NumberInput
          label="Intervalle de vérification (heures)"
          min={1}
          value={intervalHours}
          onChange={(v) => {
            setIntervalHours(typeof v === 'number' ? v : Number.parseInt(String(v), 10) || 12);
            setSaved(false);
          }}
          maw={260}
        />
        <Group>
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer les réglages
          </Button>
          <Button variant="default" onClick={() => void checkNow()}>
            Vérifier maintenant
          </Button>
        </Group>
        {saved && (
          <Text c="green" size="sm">
            Enregistré.
          </Text>
        )}
        {checkResult && (
          <Text c="dimmed" size="sm">
            {checkResult}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function AddSection({
  onAdded,
  onError,
}: {
  onAdded: () => void;
  onError: (e: string) => void;
}): JSX.Element {
  const [ean, setEan] = useState('');
  const [threshold, setThreshold] = useState<number | ''>('');
  const [adding, setAdding] = useState(false);

  const add = async (): Promise<void> => {
    setAdding(true);
    try {
      await api.addTrackedProduct({ ean: ean.trim(), threshold: Number(threshold) });
      setEan('');
      setThreshold('');
      onAdded();
    } catch (e) {
      onError(message(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Title order={4}>Suivre un produit</Title>
        <Group align="flex-end" gap="xs">
          <TextInput
            label="EAN (code-barres)"
            value={ean}
            onChange={(e) => setEan(e.currentTarget.value)}
            maw={220}
          />
          <NumberInput
            label="Seuil d'alerte (€)"
            min={0}
            decimalScale={2}
            value={threshold}
            onChange={(v) => setThreshold(typeof v === 'number' ? v : '')}
            maw={180}
          />
          <Button
            onClick={() => void add()}
            loading={adding}
            disabled={ean.trim() === '' || threshold === '' || Number(threshold) <= 0}
          >
            Suivre
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function TrackedTable({
  products,
  onChanged,
  onError,
}: {
  products: TrackedProduct[];
  onChanged: () => void;
  onError: (e: string) => void;
}): JSX.Element {
  const remove = async (productId: string): Promise<void> => {
    try {
      await api.removeTrackedProduct(productId);
      onChanged();
    } catch (e) {
      onError(message(e));
    }
  };

  if (products.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        Aucun produit suivi pour le moment.
      </Text>
    );
  }

  return (
    <Card withBorder>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Produit</Table.Th>
            <Table.Th>EAN</Table.Th>
            <Table.Th>Prix actuel</Table.Th>
            <Table.Th>Seuil</Table.Th>
            <Table.Th>Dernier contrôle</Table.Th>
            <Table.Th>État</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {products.map((p) => (
            <Table.Tr key={p.productId}>
              <Table.Td>{p.label ?? p.productId}</Table.Td>
              <Table.Td>{p.ean ?? '—'}</Table.Td>
              <Table.Td>{euro(p.lastPrice)}</Table.Td>
              <Table.Td>
                <ThresholdEditor
                  productId={p.productId}
                  value={p.threshold}
                  onSaved={onChanged}
                  onError={onError}
                />
              </Table.Td>
              <Table.Td>{formatTime(p.lastCheckedAt)}</Table.Td>
              <Table.Td>
                <Badge color={p.armed ? 'green' : 'orange'} variant="light">
                  {p.armed ? 'Armé' : 'Alerté'}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  onClick={() => void remove(p.productId)}
                >
                  Supprimer
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function ThresholdEditor({
  productId,
  value,
  onSaved,
  onError,
}: {
  productId: string;
  value: number;
  onSaved: () => void;
  onError: (e: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<number>(value);
  const save = async (): Promise<void> => {
    if (draft === value || draft <= 0) return;
    try {
      await api.updateThreshold(productId, draft);
      onSaved();
    } catch (e) {
      onError(message(e));
    }
  };
  return (
    <Group gap={4} wrap="nowrap">
      <NumberInput
        aria-label={`Seuil ${productId}`}
        min={0}
        decimalScale={2}
        value={draft}
        onChange={(v) => setDraft(typeof v === 'number' ? v : 0)}
        w={90}
        size="xs"
      />
      <Button
        size="xs"
        variant="subtle"
        onClick={() => void save()}
        disabled={draft === value || draft <= 0}
      >
        OK
      </Button>
    </Group>
  );
}
