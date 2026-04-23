import React, { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import RootLayout from '@/layouts/RootLayout';
import MainMenu from '@/pages/MainMenu';

const FriendsPage = lazy(() => import('@/pages/FriendsPage'));
const TeamDetailPage = lazy(() => import('@/pages/TeamDetailPage'));
const TeamPlanning = lazy(() => import('@/pages/TeamPlanning'));
const TransferMarket = lazy(() => import('@/pages/TransferMarket'));
const Youth = lazy(() => import('@/pages/Youth'));
const MyFixturesPage = lazy(() => import('@/pages/MyFixturesPage'));
const LeaguesListPage = lazy(() => import('@/pages/LeaguesListPage'));
const LeagueDetailPage = lazy(() => import('@/pages/LeagueDetailPage'));
const Training = lazy(() => import('@/pages/Training'));
const MatchPreview = lazy(() => import('@/pages/MatchPreview'));
const MatchSimulationLegacy = lazy(() => import('@/pages/MatchSimulationLegacy'));
const MatchSimulationDemo = lazy(() => import('@/pages/MatchSimulation'));
const MatchSimulationIframe = lazy(() => import('@/pages/MatchSimulationIframe'));
const UnityAutoSeed = lazy(() => import('@/pages/UnityAutoSeed'));
const LiveDebugPage = lazy(() => import('@/pages/LiveDebugPage'));
const MatchWatcherPage = lazy(() => import('@/pages/MatchWatcherPage'));
const Finance = lazy(() => import('@/pages/Finance'));
const TeamAssetsPage = lazy(() => import('@/pages/TeamAssets'));
const Settings = lazy(() => import('@/pages/Settings'));
const ContactPage = lazy(() => import('@/pages/Contact'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const DiamondsPage = lazy(() => import('@/features/diamonds/DiamondsPage'));
const AcademyPage = lazy(() => import('@/features/academy/AcademyPage'));
const StandingsPage = lazy(() => import('@/pages/StandingsPage'));
const LegendPackPage = lazy(() => import('@/features/legends/LegendPackPage'));
const VipStorePage = lazy(() => import('@/pages/VipStore'));
const MatchesHistoryPage = lazy(() => import('@/pages/MatchesHistoryPage'));
const MatchReplayPage = lazy(() => import('@/pages/MatchReplayPage'));
const MatchVideoPage = lazy(() => import('@/pages/MatchVideoPage'));
const FriendlyMatchPage = lazy(() => import('@/pages/FriendlyMatchPage'));
const ChatModerationAdmin = lazy(() => import('@/pages/ChatModerationAdmin'));
const ChampionsLeaguePage = lazy(() => import('@/pages/ChampionsLeaguePage'));
const LiveLeagueOpsPage = lazy(() => import('@/pages/LiveLeagueOpsPage'));

const PageFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-300">
    <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm">
      Yukleniyor...
    </div>
  </div>
);

const lazyPage = (element: React.ReactNode) => (
  <Suspense fallback={<PageFallback />}>{element}</Suspense>
);

export const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      children: [
        { path: '/', element: <MainMenu /> },
        { path: '/champions-league', element: lazyPage(<ChampionsLeaguePage />) },
        { path: '/team-planning', element: lazyPage(<TeamPlanning />) },
        { path: '/youth', element: lazyPage(<Youth />) },
        { path: '/friends', element: lazyPage(<FriendsPage />) },
        { path: '/teams/:teamId', element: lazyPage(<TeamDetailPage />) },
        { path: '/transfer-market', element: lazyPage(<TransferMarket />) },
        { path: '/fixtures', element: lazyPage(<MyFixturesPage />) },
        { path: '/my-matches', element: lazyPage(<MyFixturesPage />) },
        { path: '/standings', element: lazyPage(<StandingsPage />) },
        { path: '/leagues', element: lazyPage(<LeaguesListPage />) },
        { path: '/leagues/:leagueId', element: lazyPage(<LeagueDetailPage />) },
        { path: '/training', element: lazyPage(<Training />) },
        { path: '/match-preview', element: lazyPage(<MatchPreview />) },
        { path: '/match-simulation', element: lazyPage(<MatchSimulationLegacy />) },
        { path: '/match-simulation-demo', element: lazyPage(<MatchSimulationDemo />) },
        { path: '/match-simulation-iframe', element: lazyPage(<MatchSimulationIframe />) },
        { path: '/unity-auto-seed', element: lazyPage(<UnityAutoSeed />) },
        { path: '/team-assets', element: lazyPage(<TeamAssetsPage />) },
        { path: '/live-debug', element: lazyPage(<LiveDebugPage />) },
        { path: '/match/:id', element: lazyPage(<MatchWatcherPage />) },
        { path: '/match-history', element: lazyPage(<MyFixturesPage />) },
        { path: '/matches-history', element: lazyPage(<MatchesHistoryPage />) },
        { path: '/match-replay', element: lazyPage(<MatchReplayPage />) },
        { path: '/match-video', element: lazyPage(<MatchVideoPage />) },
        { path: '/friendly-match', element: lazyPage(<FriendlyMatchPage />) },
        { path: '/finance', element: lazyPage(<Finance />) },
        { path: '/settings', element: lazyPage(<Settings />) },
        { path: '/contact', element: lazyPage(<ContactPage />) },
        { path: '/store/diamonds', element: lazyPage(<DiamondsPage />) },
        { path: '/store/vip', element: lazyPage(<VipStorePage />) },
        { path: '/academy', element: lazyPage(<AcademyPage />) },
        { path: '/legend-pack', element: lazyPage(<LegendPackPage />) },
        { path: '/admin/chat-moderation', element: lazyPage(<ChatModerationAdmin />) },
        { path: '/admin/live-league', element: lazyPage(<LiveLeagueOpsPage />) },
        { path: '*', element: lazyPage(<NotFound />) },
      ],
    },
  ],
  {
    future: {
      // createBrowserRouter icin bu flag gecerli (TS hatasi vermeyen)
      v7_relativeSplatPath: true,
    },
  },
);
