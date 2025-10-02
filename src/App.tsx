import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { DiamondProvider } from '@/contexts/DiamondContext';
import { router } from '@/routes/router';
import { InventoryProvider } from '@/contexts/InventoryContext';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <DiamondProvider>
          <InventoryProvider>
            <TooltipProvider>
              <Toaster />
              <RouterProvider
                router={router}
                future={{ v7_startTransition: true }} // v7 uyarısını burada sustur
              />
            </TooltipProvider>
          </InventoryProvider>
        </DiamondProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
