import { createBrowserRouter } from 'react-router-dom';
import RootLayout from '@/layouts/RootLayout';

export const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      children: [
        { path: '/',            lazy: () => import('@/pages/MainMenu').then(m => ({ Component: m.default })) },
        { path: '/team-planning', lazy: () => import('@/pages/TeamPlanning').then(m => ({ Component: m.default })) },
        { path: '/youth',       lazy: () => import('@/pages/Youth').then(m => ({ Component: m.default })) },
        { path: '/transfer-market', lazy: () => import('@/pages/TransferMarket').then(m => ({ Component: m.default })) },
        { path: '/fixtures',    lazy: () => import('@/pages/MyFixturesPage').then(m => ({ Component: m.default })) },
        { path: '/my-matches',  lazy: () => import('@/pages/MyFixturesPage').then(m => ({ Component: m.default })) },
        { path: '/standings',   lazy: () => import('@/pages/StandingsPage').then(m => ({ Component: m.default })) },
        { path: '/leagues',     lazy: () => import('@/pages/LeaguesListPage').then(m => ({ Component: m.default })) },
        { path: '/leagues/:leagueId', lazy: () => import('@/pages/LeagueDetailPage').then(m => ({ Component: m.default })) },
        { path: '/training',    lazy: () => import('@/pages/Training').then(m => ({ Component: m.default })) },
        { path: '/match-preview', lazy: () => import('@/pages/MatchPreview').then(m => ({ Component: m.default })) },
        { path: '/match-simulation', lazy: () => import('@/pages/MatchSimulationLegacy').then(m => ({ Component: m.default })) },
        { path: '/match-simulation-demo', lazy: () => import('@/pages/MatchSimulation').then(m => ({ Component: m.default })) },
        { path: '/match-simulation-iframe', lazy: () => import('@/pages/MatchSimulationIframe').then(m => ({ Component: m.default })) },
        { path: '/unity-auto-seed', lazy: () => import('@/pages/UnityAutoSeed').then(m => ({ Component: m.default })) },
        { path: '/live-debug',  lazy: () => import('@/pages/LiveDebugPage').then(m => ({ Component: m.default })) },
        { path: '/match/:id',   lazy: () => import('@/pages/MatchWatcherPage').then(m => ({ Component: m.default })) },
        { path: '/match-history', lazy: () => import('@/pages/MyFixturesPage').then(m => ({ Component: m.default })) },
        { path: '/finance',     lazy: () => import('@/pages/Finance').then(m => ({ Component: m.default })) },
        { path: '/settings',    lazy: () => import('@/pages/Settings').then(m => ({ Component: m.default })) },
        { path: '/contact',     lazy: () => import('@/pages/Contact').then(m => ({ Component: m.default })) },
        { path: '/store/diamonds', lazy: () => import('@/features/diamonds/DiamondsPage').then(m => ({ Component: m.default })) },
        { path: '/store/vip',   lazy: () => import('@/pages/VipStore').then(m => ({ Component: m.default })) },
        { path: '/academy',     lazy: () => import('@/features/academy/AcademyPage').then(m => ({ Component: m.default })) },
        { path: '/legend-pack', lazy: () => import('@/features/legends/LegendPackPage').then(m => ({ Component: m.default })) },
        { path: '*',            lazy: () => import('@/pages/NotFound').then(m => ({ Component: m.default })) },
      ],
    },
  ],
  {
    future: { v7_relativeSplatPath: true },
  },
);
