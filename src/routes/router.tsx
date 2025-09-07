import { createBrowserRouter } from 'react-router-dom';
import RootLayout from '@/layouts/RootLayout';

// Pages
import MainMenu from '@/pages/MainMenu';
import TeamPlanning from '@/pages/TeamPlanning';
import Youth from '@/pages/Youth';
import MyFixturesPage from '@/pages/MyFixturesPage';
import LeaguesListPage from '@/pages/LeaguesListPage';
import LeagueDetailPage from '@/pages/LeagueDetailPage';
import Training from '@/pages/Training';
import MatchPreview from '@/pages/MatchPreview';
import MatchSimulation from '@/pages/MatchSimulation';
import UnityAutoSeed from '@/pages/UnityAutoSeed';
import LiveDebugPage from '@/pages/LiveDebugPage';
import MatchWatcherPage from '@/pages/MatchWatcherPage';
import Finance from '@/pages/Finance';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';
import DiamondsPage from '@/features/diamonds/DiamondsPage';
import AcademyPage from '@/features/academy/AcademyPage';
import StandingsPage from '@/pages/StandingsPage';

export const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      children: [
        { path: '/', element: <MainMenu /> },
        { path: '/team-planning', element: <TeamPlanning /> },
        { path: '/youth', element: <Youth /> },
        { path: '/fixtures', element: <MyFixturesPage /> },
        { path: '/my-matches', element: <MyFixturesPage /> },
        { path: '/standings', element: <StandingsPage /> },
        { path: '/leagues', element: <LeaguesListPage /> },
        { path: '/leagues/:leagueId', element: <LeagueDetailPage /> },
        { path: '/training', element: <Training /> },
        { path: '/match-preview', element: <MatchPreview /> },
        { path: '/match-simulation', element: <MatchSimulation /> },
        { path: '/unity-auto-seed', element: <UnityAutoSeed /> },
        { path: '/live-debug', element: <LiveDebugPage /> },
        { path: '/match/:id', element: <MatchWatcherPage /> },
        { path: '/match-history', element: <MyFixturesPage /> },
        { path: '/finance', element: <Finance /> },
        { path: '/profile', element: <Settings /> },
        { path: '/settings', element: <Settings /> },
        { path: '/store/diamonds', element: <DiamondsPage /> },
        { path: '/academy', element: <AcademyPage /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  {
    future: {
      // createBrowserRouter için bu flag geçerli (TS hatası vermeyen)
      v7_relativeSplatPath: true,
    },
  },
);
