import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from 'react';
import { onAuthStateChanged, updateProfile } from 'firebase/auth';
import { User } from '@/types';
import { auth } from '@/services/firebase';
import {
  signIn,
  signUp,
  signOutUser,
  signInWithGoogle,
  signInWithApple,
} from '@/services/auth';
import { createInitialTeam, getTeam } from '@/services/team';
import { requestJoinLeague } from '@/services/leagues';
import { generateRandomName } from '@/lib/names';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, teamName: string) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const team = await getTeam(firebaseUser.uid);
        const usernameFallback = firebaseUser.email?.split('@')[0] || 'Kullanıcı';
        const teamName = team?.name || firebaseUser.displayName || usernameFallback || 'Takımım';
        const username = team?.manager || usernameFallback;
        setUser({
          id: firebaseUser.uid,
          username,
          email: firebaseUser.email || '',
          teamName,
          teamLogo: '⚽',
          connectedAccounts: { google: false, apple: false },
        });
        if (!team) {
          await createInitialTeam(firebaseUser.uid, teamName, username);
          await requestJoinLeague(firebaseUser.uid);
        }
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
        const managerName = generateRandomName();
        try {
          // Profil ve takım oluşturmayı tamamla
          await updateProfile(cred.user, { displayName: teamName });
          await createInitialTeam(cred.user.uid, teamName, managerName);
          await requestJoinLeague(cred.user.uid);

          // ÖNEMLİ: Kayıttan hemen sonra UI'da takım adını anında göstermek için
          // context'teki kullanıcıyı güncelle (sayfa yenilemeden çalışır)
          setUser({
            id: cred.user.uid,
            username: managerName,
            email: cred.user.email || email,
            teamName,
            teamLogo: '⚽',
            connectedAccounts: { google: false, apple: false },
          });
        } catch (err) {
          console.error('Post-register setup failed:', err);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await signOutUser();
    setUser(null);
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      await signInWithGoogle();
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithApple = async () => {
    setIsLoading(true);
    try {
      await signInWithApple();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        logout,
        loginWithGoogle,
        loginWithApple,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
