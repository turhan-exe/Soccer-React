import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from 'react';
import { onAuthStateChanged, updateProfile, User as FirebaseUser } from 'firebase/auth';
import { User } from '@/types';
import { auth } from '@/services/firebase';
import {
  signIn,
  signUp,
  signOutUser,
  signInWithGoogle,
  signInWithApple,
} from '@/services/auth';
import { createInitialTeam, getTeam, updateTeamName } from '@/services/team';
import { requestAssign } from '@/services/leagues';
import { generateRandomName } from '@/lib/names';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, teamName: string) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  registerWithGoogle: (teamName: string) => Promise<void>;
  registerWithApple: (teamName: string) => Promise<void>;
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
          // Slot tabanlı: sıradaki ligde rastgele bir BOT'un yerine geç
          await requestAssign(firebaseUser.uid);
        } else if (!(team as any)?.leagueId) {
          try { await requestAssign(firebaseUser.uid); } catch {}
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

  const waitForFirebaseUser = async (
    expectedUid: string,
    timeoutMs = 5000,
  ): Promise<void> => {
    if (auth.currentUser?.uid === expectedUid) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let unsubscribe: () => void = () => {};
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve();
      }, timeoutMs);

      unsubscribe = onAuthStateChanged(
        auth,
        (firebaseUser) => {
          if (firebaseUser?.uid === expectedUid) {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        },
        (error) => {
          clearTimeout(timeout);
          unsubscribe();
          reject(error);
        },
      );
    });
  };

  const register = async (
    email: string,
    password: string,
    teamName: string,
  ) => {
    setIsLoading(true);
    try {
      const cred = await signUp(email, password);
      const firebaseUser = cred.user;
      if (firebaseUser) {
        // Ensure auth state is fully ready before attempting Firestore writes
        try {
          await waitForFirebaseUser(firebaseUser.uid);
        } catch (waitError) {
          console.warn('[AuthContext] Waiting for auth state after sign up failed', waitError);
        }

        // Ensure Firestore has a fresh ID token – without it writes can fail on first sign up.
        try {
          await firebaseUser.getIdToken(true);
        } catch (tokenError) {
          console.warn('[AuthContext] Failed to refresh ID token after sign up', tokenError);
        }
        const managerName = generateRandomName();
        try {
          await updateProfile(firebaseUser, { displayName: teamName }).catch((err) => {
            console.warn('[AuthContext] Failed to update profile after sign up', err);
          });

          const attemptCreateInitialTeam = async (
            user: FirebaseUser,
          ): Promise<void> => {
            const MAX_ATTEMPTS = 3;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
              try {
                await createInitialTeam(user.uid, teamName, managerName);
                return;
              } catch (createError) {
                const errorMessage = createError instanceof Error ? createError.message : '';
                const shouldRetry =
                  attempt < MAX_ATTEMPTS &&
                  (/uid/i.test(errorMessage) || /permission/i.test(errorMessage));
                if (!shouldRetry) {
                  throw createError;
                }

                try {
                  await user.getIdToken(true);
                } catch (refreshError) {
                  console.warn('[AuthContext] Retrying team creation token refresh failed', refreshError);
                }

                await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
              }
            }
          };

          await attemptCreateInitialTeam(firebaseUser);

          // UI'yı gecikmesiz güncelle
          setUser({
            id: firebaseUser.uid,
            username: managerName,
            email: firebaseUser.email || email,
            teamName,
            teamLogo: '⚽',
            connectedAccounts: { google: false, apple: false },
          });

          // Lig atamasını arka planda tetikle; başarısız olursa yalnızca logla
          void requestAssign(firebaseUser.uid).catch((err) => {
            console.warn('[AuthContext] League assignment failed after registration', err);
          });
        } catch (err) {
          console.error('Post-register setup failed:', err);
          throw err;
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

  const handleSocialRegistration = async (
    provider: 'google' | 'apple',
    teamName: string,
  ) => {
    const trimmedName = teamName.trim();
    if (!trimmedName) {
      throw new Error('Takım adı gerekli');
    }

    setIsLoading(true);
    try {
      const credential =
        provider === 'google' ? await signInWithGoogle() : await signInWithApple();

      const firebaseUser = credential.user;
      if (!firebaseUser) {
        return;
      }

      try {
        await firebaseUser.getIdToken(true);
      } catch (tokenError) {
        console.warn('[AuthContext] Failed to refresh ID token after social registration', tokenError);
      }

      const team = await getTeam(firebaseUser.uid);
      const managerName = team?.manager || generateRandomName();

      await updateProfile(firebaseUser, { displayName: trimmedName });

      if (!team) {
        await createInitialTeam(firebaseUser.uid, trimmedName, managerName);
        void requestAssign(firebaseUser.uid).catch((err) => {
          console.warn('[AuthContext] League assignment failed after social registration', err);
        });
      } else if (team.name !== trimmedName) {
        await updateTeamName(firebaseUser.uid, trimmedName);
      }

      setUser({
        id: firebaseUser.uid,
        username: managerName,
        email: firebaseUser.email || '',
        teamName: trimmedName,
        teamLogo: '⚽',
        connectedAccounts: {
          google: provider === 'google',
          apple: provider === 'apple',
        },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const registerWithGoogle = async (teamName: string) => {
    await handleSocialRegistration('google', teamName);
  };

  const registerWithApple = async (teamName: string) => {
    await handleSocialRegistration('apple', teamName);
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
        registerWithGoogle,
        registerWithApple,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
