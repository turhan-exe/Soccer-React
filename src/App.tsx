import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { DiamondProvider } from '@/contexts/DiamondContext';
import TopBar from '@/components/layout/TopBar';

// Pages
import Auth from './pages/Auth';
import MainMenu from './pages/MainMenu';
import TeamPlanning from './pages/TeamPlanning';
import Youth from './pages/Youth';
import Fixtures from './pages/Fixtures';
import Leagues from './pages/Leagues';
import Training from './pages/Training';
import MatchPreview from './pages/MatchPreview';
import MatchSimulation from './pages/MatchSimulation';
import Finance from './pages/Finance';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';
import DiamondsPage from '@/features/diamonds/DiamondsPage';
import AcademyPage from '@/features/academy/AcademyPage';

const queryClient = new QueryClient();

const AppContent = () => {
  const { user } = useAuth();

  if (!user) {
    return <Auth />;
  }

  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/" element={<MainMenu />} />
        <Route path="/team-planning" element={<TeamPlanning />} />
        <Route path="/youth" element={<Youth />} />
        <Route path="/fixtures" element={<Fixtures />} />
        <Route path="/leagues" element={<Leagues />} />
        <Route path="/training" element={<Training />} />
        <Route path="/match-preview" element={<MatchPreview />} />
        <Route path="/match-simulation" element={<MatchSimulation />} />
        <Route path="/match-history" element={<Fixtures />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/profile" element={<Settings />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/store/diamonds" element={<DiamondsPage />} />
        <Route path="/academy" element={<AcademyPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <DiamondProvider>
            <TooltipProvider>
              <Toaster />
              <AppContent />
            </TooltipProvider>
          </DiamondProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </BrowserRouter>
);

export default App;
