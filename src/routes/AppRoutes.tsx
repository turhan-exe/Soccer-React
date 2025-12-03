import { Routes, Route } from 'react-router-dom';
import MainMenu from '@/pages/MainMenu';
import TeamPlanning from '@/pages/TeamPlanning';
import TransferMarket from '@/pages/TransferMarket';
import Youth from '@/pages/Youth';
import MyFixturesPage from '@/pages/MyFixturesPage';
import LeaguesListPage from '@/pages/LeaguesListPage';
import LeagueDetailPage from '@/pages/LeagueDetailPage';
import Training from '@/pages/Training';
import MatchPreview from '@/pages/MatchPreview';
import MatchSimulationLegacy from '@/pages/MatchSimulationLegacy';
import MatchSimulationDemo from '@/pages/MatchSimulation';
import MatchSimulationIframe from '@/pages/MatchSimulationIframe';
import Finance from '@/pages/Finance';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';
import DiamondsPage from '@/features/diamonds/DiamondsPage';
import AcademyPage from '@/features/academy/AcademyPage';
import LegendPackPage from '@/features/legends/LegendPackPage';
import StandingsPage from '@/pages/StandingsPage';
import MatchesHistoryPage from '@/pages/MatchesHistoryPage';
import MatchReplayPage from '@/pages/MatchReplayPage';
import MatchVideoPage from '@/pages/MatchVideoPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MainMenu />} />
      <Route path="/team-planning" element={<TeamPlanning />} />
      <Route path="/youth" element={<Youth />} />
      <Route path="/transfer-market" element={<TransferMarket />} />
      <Route path="/fixtures" element={<MyFixturesPage />} />
      <Route path="/my-matches" element={<MyFixturesPage />} />
      <Route path="/standings" element={<StandingsPage />} />
      <Route path="/leagues" element={<LeaguesListPage />} />
      <Route path="/leagues/:leagueId" element={<LeagueDetailPage />} />
      <Route path="/training" element={<Training />} />
      <Route path="/match-preview" element={<MatchPreview />} />
      <Route path="/match-simulation" element={<MatchSimulationLegacy />} />
      <Route path="/match-simulation-demo" element={<MatchSimulationDemo />} />
      <Route path="/match-simulation-iframe" element={<MatchSimulationIframe />} />
      <Route path="/match-history" element={<MyFixturesPage />} />
      <Route path="/matches-history" element={<MatchesHistoryPage />} />
      <Route path="/match-replay" element={<MatchReplayPage />} />
      <Route path="/match-video" element={<MatchVideoPage />} />
      <Route path="/finance" element={<Finance />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/store/diamonds" element={<DiamondsPage />} />
      <Route path="/academy" element={<AcademyPage />} />
      <Route path="/legend-pack" element={<LegendPackPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}


