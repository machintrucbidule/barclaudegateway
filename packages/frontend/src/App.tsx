import type { JSX } from 'react';
import { AppShell, Group, NavLink, ScrollArea, Title } from '@mantine/core';
import { NavLink as RouterNavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ConfigPage } from './pages/ConfigPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { MaintenancePage } from './pages/MaintenancePage.js';
import { MaintenanceBanner } from './components/MaintenanceBanner.js';
import { useErrorState } from './hooks/useErrorState.js';

const NAV = [
  { to: '/dashboard', label: 'Tableau de bord' },
  { to: '/config', label: 'Configuration' },
  { to: '/logs', label: 'Journal en direct' },
  { to: '/maintenance', label: 'Maintenance' },
] as const;

/**
 * App shell: a fixed header + a side navigation, with the active page rendered in the main area.
 * Navigation uses real URLs (react-router) so the back button and refresh land on the right page.
 */
export function App(): JSX.Element {
  // One live subscription for the whole shell: it drives both the global banner and is cheap to share.
  const errorState = useErrorState();

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md">
          <Title order={3}>BarclaudeGateway</Title>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea>
          {NAV.map((item) => (
            <NavLink key={item.to} component={RouterNavLink} to={item.to} label={item.label} />
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <MaintenanceBanner state={errorState} />
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
