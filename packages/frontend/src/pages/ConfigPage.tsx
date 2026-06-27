import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import type { ApiConfig, ConfigResponse, DestinationsResponse } from '@barclaudegateway/shared';
import { api } from '../api/client.js';

/** Merge the live list choices with any already-saved lists, so saved ones still show if the fetch failed. */
function mergeLists(data: DestinationsResponse): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const list of data.available.lists) byId.set(list.id, list.name);
  for (const list of data.enabled.lists) if (!byId.has(list.id)) byId.set(list.id, list.name);
  return [...byId].map(([id, name]) => ({ id, name }));
}

/** Drop the write-only credentials indicator, keeping only the editable static params. */
function apiConfigOf(config: ConfigResponse): ApiConfig {
  return {
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scope: config.scope,
    identityBaseUrl: config.identityBaseUrl,
    apiBaseUrl: config.apiBaseUrl,
    apiKeys: { ...config.apiKeys },
    siteMode: config.siteMode,
    siteId: config.siteId,
    haWebhookUrl: config.haWebhookUrl,
    authMode: config.authMode,
  };
}

function DestinationsSection(): JSX.Element {
  const [data, setData] = useState<DestinationsResponse | null>(null);
  const [cart, setCart] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const fresh = await api.getDestinations();
        if (!active) return;
        setData(fresh);
        setCart(fresh.enabled.cart);
        setChecked(new Set(fresh.enabled.lists.map((l) => l.id)));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Chargement impossible');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!data) return <Loader />;

  const lists = mergeLists(data);

  const toggle = (id: string, on: boolean): void => {
    setSaved(false);
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.putDestinations({ cart, lists: lists.filter((l) => checked.has(l.id)) });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Destinations d&apos;un scan</Title>
        <Text size="sm" c="dimmed">
          Un scan alimente toutes les destinations cochées.
        </Text>
        {data.listsError && (
          <Alert color="yellow">
            Listes Chronodrive indisponibles ({data.listsError.category}). Les listes déjà
            enregistrées restent modifiables.
          </Alert>
        )}
        <Checkbox
          label="Panier"
          checked={cart}
          onChange={(e) => {
            setSaved(false);
            setCart(e.currentTarget.checked);
          }}
        />
        {lists.map((list) => (
          <Checkbox
            key={list.id}
            label={list.name}
            checked={checked.has(list.id)}
            onChange={(e) => {
              toggle(list.id, e.currentTarget.checked);
            }}
          />
        ))}
        <Group>
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer les destinations
          </Button>
          {saved && (
            <Text c="green" size="sm">
              Enregistré.
            </Text>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

function CredentialsSection(): JSX.Element {
  const [set, setSet] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await api.getConfig();
        if (active) setSet(config.credentials.set);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Chargement impossible');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.putCredentials({ email, password });
      setSet(res.credentials.set);
      // Write-only: never keep the password around once it has been sent.
      setEmail('');
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Identifiants Chronodrive</Title>
        <Text size="sm">
          État&nbsp;:{' '}
          <Text span fw={600} c={set ? 'green' : 'orange'}>
            {set === null ? '…' : set ? 'configurés' : 'non configurés'}
          </Text>
        </Text>
        <Text size="xs" c="dimmed">
          Le mot de passe est stocké chiffré et n&apos;est jamais réaffiché.
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput
          label="Adresse e-mail"
          value={email}
          onChange={(e) => {
            setEmail(e.currentTarget.value);
          }}
          autoComplete="username"
        />
        <PasswordInput
          label="Mot de passe"
          value={password}
          onChange={(e) => {
            setPassword(e.currentTarget.value);
          }}
          autoComplete="new-password"
        />
        <Group>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={email.trim() === '' || password === ''}
          >
            Enregistrer les identifiants
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

const API_FIELDS: Array<{ key: keyof Omit<ApiConfig, 'apiKeys'>; label: string }> = [
  { key: 'clientId', label: 'client_id' },
  { key: 'redirectUri', label: 'redirect_uri' },
  { key: 'scope', label: 'scope' },
  { key: 'identityBaseUrl', label: 'identity_base_url' },
  { key: 'apiBaseUrl', label: 'api_base_url' },
  { key: 'siteMode', label: 'site_mode' },
  { key: 'siteId', label: 'Identifiant magasin (site_id, optionnel)' },
];

const KEY_FIELDS: Array<{ key: keyof ApiConfig['apiKeys']; label: string }> = [
  { key: 'search', label: 'x-api-key (search)' },
  { key: 'customerCartRead', label: 'x-api-key (cart read)' },
  { key: 'cartWrite', label: 'x-api-key (cart write)' },
  { key: 'shoppingLists', label: 'x-api-key (shopping lists)' },
];

function ApiParamsSection(): JSX.Element {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const fresh = await api.getConfig();
        if (active) setConfig(apiConfigOf(fresh));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Chargement impossible');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error && !config) return <Alert color="red">{error}</Alert>;
  if (!config) return <Loader />;

  const setField = (key: keyof Omit<ApiConfig, 'apiKeys'>, value: string): void => {
    setSaved(false);
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };
  const setKey = (key: keyof ApiConfig['apiKeys'], value: string): void => {
    setSaved(false);
    setConfig((prev) => (prev ? { ...prev, apiKeys: { ...prev.apiKeys, [key]: value } } : prev));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.putConfig(config);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Paramètres techniques de l&apos;API</Title>
        <Text size="xs" c="dimmed">
          À ne modifier qu&apos;en cas de rotation des clés ou de changement d&apos;URL côté
          Chronodrive.
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {API_FIELDS.map((field) => (
          <TextInput
            key={field.key}
            label={field.label}
            value={config[field.key]}
            onChange={(e) => {
              setField(field.key, e.currentTarget.value);
            }}
          />
        ))}
        {KEY_FIELDS.map((field) => (
          <TextInput
            key={field.key}
            label={field.label}
            value={config.apiKeys[field.key]}
            onChange={(e) => {
              setKey(field.key, e.currentTarget.value);
            }}
          />
        ))}
        <Group>
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer les paramètres
          </Button>
          {saved && (
            <Text c="green" size="sm">
              Enregistré.
            </Text>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

function NotificationsSection(): JSX.Element {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const fresh = await api.getConfig();
        if (active) setConfig(apiConfigOf(fresh));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Chargement impossible');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error && !config) return <Alert color="red">{error}</Alert>;
  if (!config) return <Loader />;

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.putConfig(config);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const test = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.sendHaWebhookTest();
      setTestResult(
        res.ok
          ? { ok: true, text: 'Test envoyé : Home Assistant a bien reçu le message.' }
          : { ok: false, text: `Échec : ${res.error ?? 'erreur inconnue'}` },
      );
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : 'Test impossible' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Alerte Home Assistant</Title>
        <Text size="sm" c="dimmed">
          En cas de panne critique de l&apos;API Chronodrive, la passerelle peut prévenir Home
          Assistant via un webhook. Laissez vide pour désactiver l&apos;alerte.
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput
          label="URL du webhook Home Assistant (optionnel)"
          placeholder="https://home-assistant.local/api/webhook/…"
          value={config.haWebhookUrl}
          onChange={(e) => {
            setSaved(false);
            setConfig((prev) => (prev ? { ...prev, haWebhookUrl: e.currentTarget.value } : prev));
          }}
        />
        <Text size="xs" c="dimmed">
          Le test envoie un message d&apos;exemple à l&apos;URL <b>déjà enregistrée</b> : pensez à
          enregistrer avant de tester.
        </Text>
        <Group>
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer
          </Button>
          <Button
            variant="default"
            onClick={() => void test()}
            loading={testing}
            disabled={config.haWebhookUrl.trim() === ''}
          >
            Tester le webhook
          </Button>
          {saved && (
            <Text c="green" size="sm">
              Enregistré.
            </Text>
          )}
        </Group>
        {testResult && (
          <Text c={testResult.ok ? 'green' : 'red'} size="sm">
            {testResult.text}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/** BL-006: choose the auth-token policy (lazy vs keep-alive) + a manual "connect now" probe. */
function ConnectionModeSection(): JSX.Element {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const fresh = await api.getConfig();
        if (active) setConfig(apiConfigOf(fresh));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Chargement impossible');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error && !config) return <Alert color="red">{error}</Alert>;
  if (!config) return <Loader />;

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.putConfig(config);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const checkNow = async (): Promise<void> => {
    setChecking(true);
    setCheckResult(null);
    try {
      const report = await api.connectNow();
      if (report.configured === false) {
        setCheckResult({ ok: false, text: 'Identifiants Chronodrive non renseignés.' });
      } else if (report.ok) {
        const okCount = report.checks.filter((c) => c.status === 'ok').length;
        setCheckResult({ ok: true, text: `Connexion réussie (${okCount} vérification(s) OK).` });
      } else {
        const failing = report.checks.find((c) => c.status === 'error');
        setCheckResult({
          ok: false,
          text: `Connexion en échec${failing ? ` : ${failing.name} (${failing.detail})` : ''}.`,
        });
      }
    } catch (e) {
      setCheckResult({ ok: false, text: e instanceof Error ? e.message : 'Connexion impossible' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Gestion de la connexion</Title>
        <Text size="sm" c="dimmed">
          Choisissez quand la passerelle se connecte à Chronodrive.
        </Text>
        <SegmentedControl
          value={config.authMode}
          onChange={(value) => {
            setSaved(false);
            setConfig((prev) =>
              prev ? { ...prev, authMode: value as ApiConfig['authMode'] } : prev,
            );
          }}
          data={[
            { label: 'À la demande (économique)', value: 'lazy' },
            { label: 'Connexion maintenue', value: 'keepalive' },
          ]}
        />
        <Text size="xs" c="dimmed">
          {config.authMode === 'lazy' ? (
            <>
              <b>À la demande</b> : la passerelle ne se connecte que lorsqu&apos;un scan le
              nécessite. Moins d&apos;appels en arrière-plan, mais le premier scan après une période
              d&apos;inactivité est un peu plus lent et la détection automatique de panne est en
              veille tant qu&apos;aucun scan n&apos;a lieu.
            </>
          ) : (
            <>
              <b>Connexion maintenue</b> : la passerelle garde la session active en arrière-plan
              (rafraîchissement ≈ toutes les 2&nbsp;h) et vérifie l&apos;état régulièrement. Scans
              réactifs, mais des appels réguliers à l&apos;API Chronodrive.
            </>
          )}
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        <Group>
          <Button onClick={() => void save()} loading={saving}>
            Enregistrer le mode de connexion
          </Button>
          <Button variant="default" onClick={() => void checkNow()} loading={checking}>
            Vérifier la connexion maintenant
          </Button>
          {saved && (
            <Text c="green" size="sm">
              Enregistré.
            </Text>
          )}
        </Group>
        {checkResult && (
          <Text c={checkResult.ok ? 'green' : 'red'} size="sm">
            {checkResult.text}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

export function ConfigPage(): JSX.Element {
  return (
    <Stack maw={640}>
      <Title order={2}>Configuration</Title>
      <DestinationsSection />
      <CredentialsSection />
      <ConnectionModeSection />
      <ApiParamsSection />
      <NotificationsSection />
    </Stack>
  );
}
