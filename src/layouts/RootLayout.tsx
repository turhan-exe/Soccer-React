
import { Outlet } from 'react-router-dom';
import TopBar from '@/components/layout/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import Auth from '@/pages/Auth';

const RootLayout = () => {
  const { user } = useAuth();

  if (!user) {
    return <Auth />;
  }

  return (
    <>
      <TopBar />
      <Outlet />
    </>
  );
};

export default RootLayout;
