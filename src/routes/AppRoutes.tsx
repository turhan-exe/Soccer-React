import { Routes, Route } from 'react-router-dom';
import MainMenu from '@/pages/MainMenu';
import TeamPlanning from '@/pages/TeamPlanning';
import Youth from '@/pages/Youth';
import MyFixturesPage from '@/pages/MyFixturesPage';
import LeaguesListPage from '@/pages/LeaguesListPage';
import LeagueDetailPage from '@/pages/LeagueDetailPage';
import Training from '@/pages/Training';
import MatchPreview from '@/pages/MatchPreview';
import MatchSimulation from '@/pages/MatchSimulation';
import Finance from '@/pages/Finance';
import Settings from '@/pages/Settings';
import NotFound from '@/pages/NotFound';
import DiamondsPage from '@/features/diamonds/DiamondsPage';
import AcademyPage from '@/features/academy/AcademyPage';
import StandingsPage from '@/pages/StandingsPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MainMenu />} />
      <Route path="/team-planning" element={<TeamPlanning />} />
      <Route path="/youth" element={<Youth />} />
      <Route path="/fixtures" element={<MyFixturesPage />} />
      <Route path="/my-matches" element={<MyFixturesPage />} />
      <Route path="/standings" element={<StandingsPage />} />
      <Route path="/leagues" element={<LeaguesListPage />} />
      <Route path="/leagues/:leagueId" element={<LeagueDetailPage />} />
      <Route path="/training" element={<Training />} />
      <Route path="/match-preview" element={<MatchPreview />} />
      <Route path="/match-simulation" element={<MatchSimulation />} />
      <Route path="/match-history" element={<MyFixturesPage />} />
      <Route path="/finance" element={<Finance />} />
      <Route path="/profile" element={<Settings />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/store/diamonds" element={<DiamondsPage />} />
      <Route path="/academy" element={<AcademyPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
