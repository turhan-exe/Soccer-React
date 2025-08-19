import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from 'react';
import { onAuthStateChanged, updateProfile } from 'firebase/auth';
import { User } from '@/types';
import { auth } from '@/firebase';
import { signIn, signUp, signOutUser } from '@/services/auth';
import { createInitialTeam, getTeam } from '@/services/team';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, teamName: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const teamName = firebaseUser.displayName || 'Takımım';
        setUser({
          id: firebaseUser.uid,
          username: firebaseUser.email?.split('@')[0] || 'Kullanıcı',
          email: firebaseUser.email || '',
          teamName,
          teamLogo: '⚽',
          connectedAccounts: { google: false, apple: false },
        });
        (async () => {
          const team = await getTeam(firebaseUser.uid);
          if (!team) {
            await createInitialTeam(firebaseUser.uid, teamName, teamName);
          }
        })();
      } else {
        setUser(null);
      }
    });
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      await signIn(email, password);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (
    email: string,
    password: string,
    teamName: string,
  ) => {
    setIsLoading(true);
    try {
      const cred = await signUp(email, password);
      if (cred.user) {
        await updateProfile(cred.user, { displayName: teamName });
        await createInitialTeam(cred.user.uid, teamName, teamName);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await signOutUser();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};