import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useCallback,
} from 'react';
import { onAuthStateChanged, updateProfile, User as FirebaseUser } from 'firebase/auth';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { User } from '@/types';
import { auth } from '@/services/firebase';
import {
  signIn,
  signUp,
  signOutUser,
  signInWithGoogle,
  signInWithApple,
  getAuthRedirectResult,
  requestPasswordReset,
} from '@/services/auth';
import { createInitialTeam, getTeam, updateTeamName } from '@/services/team';
import { requestAssign } from '@/services/leagues';
import { generateRandomName } from '@/lib/names';
import { getUserProfile } from '@/services/users';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, teamName: string) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  registerWithGoogle: (teamName: string) => Promise<void>;
  registerWithApple: (teamName: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  isAuthReady: boolean;
  isLoading: boolean;
  refreshTeamInfo: () => Promise<void>;
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
  const [isAuthReady, setIsAuthReady] = useState(false);

  type PendingSocialRegistration = {
    provider: 'google' | 'apple';
    teamName: string;
  };

  const PENDING_SOCIAL_REGISTRATION_KEY = 'fm_pending_social_registration';

  const savePendingSocialRegistration = (payload: PendingSocialRegistration) => {
    try {
      window.localStorage.setItem(PENDING_SOCIAL_REGISTRATION_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[AuthContext] Failed to persist pending social registration', error);
    }
  };

  const consumePendingSocialRegistration = (): PendingSocialRegistration | null => {
    try {
      const raw = window.localStorage.getItem(PENDING_SOCIAL_REGISTRATION_KEY);
      if (!raw) {
        return null;
      }
      window.localStorage.removeItem(PENDING_SOCIAL_REGISTRATION_KEY);
      return JSON.parse(raw) as PendingSocialRegistration;
    } catch (error) {
      console.warn('[AuthContext] Failed to read pending social registration', error);
      window.localStorage.removeItem(PENDING_SOCIAL_REGISTRATION_KEY);
      return null;
    }
  };

  const getConnectedAccounts = (firebaseUser: FirebaseUser, recentlyLinked?: 'google' | 'apple') => {
    const providerIds = new Set(firebaseUser.providerData.map((provider) => provider.providerId));
    if (recentlyLinked) {
      providerIds.add(recentlyLinked === 'google' ? 'google.com' : 'apple.com');
    }
    return {
      google: providerIds.has('google.com'),
      apple: providerIds.has('apple.com'),
    };
  };

  const completeSocialRegistration = async (
    firebaseUser: FirebaseUser,
    provider: 'google' | 'apple',
    preferredTeamName?: string,
  ) => {
    const trimmedName = preferredTeamName?.trim();
    const [existingTeam, profile] = await Promise.all([
      getTeam(firebaseUser.uid),
      getUserProfile(firebaseUser.uid),
    ]);
    const managerName =
      existingTeam?.manager || firebaseUser.displayName || generateRandomName();
    const desiredTeamName =
      trimmedName || existingTeam?.name || firebaseUser.displayName || managerName || 'Takimim';

    if (trimmedName && firebaseUser.displayName !== trimmedName) {
      try {
        await updateProfile(firebaseUser, { displayName: trimmedName });
      } catch (error) {
        console.warn('[AuthContext] Failed to update profile display name', error);
      }
    }

    if (!existingTeam) {
      await createInitialTeam(firebaseUser.uid, desiredTeamName, managerName, {
        authUser: firebaseUser,
      });
      void requestAssign(firebaseUser.uid).catch((err) => {
        console.warn('[AuthContext] League assignment after social registration failed', err);
      });
    } else if (trimmedName && existingTeam.name !== trimmedName) {
      await updateTeamName(firebaseUser.uid, trimmedName);
    }

    const connectedAccounts = getConnectedAccounts(firebaseUser, provider);

    setUser({
      id: firebaseUser.uid,
      username: managerName,
      email: firebaseUser.email || '',
      teamName: trimmedName ?? existingTeam?.name ?? desiredTeamName,
      teamLogo: existingTeam?.logo ?? null,
      role: profile?.role ?? 'user',
      connectedAccounts,
      contactPhone: profile?.contactPhone ?? null,
      contactCrypto: profile?.contactCrypto ?? null,
    });
  };
  useEffect(() => {
    getAuthRedirectResult()
      .then((credential) => {
        if (credential?.user) {
          const pending = consumePendingSocialRegistration();
          if (pending) {
            void completeSocialRegistration(credential.user, pending.provider, pending.teamName);
          }
        }
      })
      .catch((error) => {
        if (error && typeof error === 'object' && 'code' in error) {
          const code = (error as { code?: string }).code;
          if (code !== 'auth/no-auth-event') {
            console.warn('[AuthContext] redirect result failed', error);
          }
        } else {
          console.warn('[AuthContext] redirect result failed', error);
        }
      });
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const deepLinkHandler = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (url && url.startsWith('fhsmanager://')) {
        getAuthRedirectResult()
          .then((credential) => {
            if (credential?.user) {
              const pending = consumePendingSocialRegistration();
              if (pending) {
                void completeSocialRegistration(credential.user, pending.provider, pending.teamName);
              }
            }
          })
          .catch((error) => {
            if (error && typeof error === 'object' && 'code' in error) {
              const code = (error as { code?: string }).code;
              if (code !== 'auth/no-auth-event') {
                console.warn('[AuthContext] redirect handling failed', error);
              }
            } else {
              console.warn('[AuthContext] redirect handling failed', error);
            }
          });
      }
    });

    return () => {
      deepLinkHandler.remove();
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const [team, profile] = await Promise.all([
            getTeam(firebaseUser.uid),
            getUserProfile(firebaseUser.uid),
          ]);
          const usernameFallback = firebaseUser.email?.split('@')[0] || 'Kullanici';
          const teamName = team?.name || firebaseUser.displayName || usernameFallback || 'Takimim';
          const username = team?.manager || usernameFallback;
          if (isActive) {
            setUser({
              id: firebaseUser.uid,
              username,
              email: firebaseUser.email || '',
              teamName,
              teamLogo: team?.logo ?? null,
              role: profile?.role ?? 'user',
              connectedAccounts: getConnectedAccounts(firebaseUser),
              contactPhone: profile?.contactPhone ?? null,
              contactCrypto: profile?.contactCrypto ?? null,
            });
          }
          if (!team) {
            await createInitialTeam(firebaseUser.uid, teamName, username, {
              authUser: firebaseUser,
            });
            // Slot tabanli: siradaki ligde rastgele bir BOT'un yerine gec
            await requestAssign(firebaseUser.uid);
          } else if (!(team as any)?.leagueId) {
            try {
              await requestAssign(firebaseUser.uid);
            } catch {}
          }
        } else if (isActive) {
          setUser(null);
        }
      } catch (err) {
        console.error('[AuthContext] Failed to handle auth state change', err);
        if (isActive) {
          setUser(null);
        }
      } finally {
        if (isActive) {
          setIsAuthReady(true);
        }
      }
    });
    return () => {
      isActive = false;
      unsubscribe();
    };
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
                await createInitialTeam(user.uid, teamName, managerName, {
                  authUser: user,
                });
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
            teamLogo: null,
            connectedAccounts: { google: false, apple: false },
            contactPhone: null,
            contactCrypto: null,
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

  const resetPassword = async (email: string) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      throw new Error('E-posta gerekli');
    }

    setIsLoading(true);
    try {
      await requestPasswordReset(trimmedEmail);
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
      throw new Error('Tak?m ad? gerekli');
    }

    setIsLoading(true);
    try {
      savePendingSocialRegistration({ provider, teamName: trimmedName });
      const credential =
        provider === 'google' ? await signInWithGoogle() : await signInWithApple();

      const firebaseUser = credential?.user;
      if (!firebaseUser) {
        return;
      }

      try {
        await firebaseUser.getIdToken(true);
      } catch (tokenError) {
        console.warn('[AuthContext] Failed to refresh ID token after social registration', tokenError);
      }

      consumePendingSocialRegistration();
      await completeSocialRegistration(firebaseUser, provider, trimmedName);
    } catch (error) {
      if (!Capacitor.isNativePlatform()) {
        consumePendingSocialRegistration();
      }
      throw error;
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

  const refreshTeamInfo = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return;
    }

    try {
      const [team, profile] = await Promise.all([
        getTeam(currentUser.uid),
        getUserProfile(currentUser.uid),
      ]);
      setUser(prev => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          teamName: team?.name ?? prev.teamName,
          teamLogo: team?.logo ?? prev.teamLogo ?? null,
          role: profile?.role ?? prev.role ?? 'user',
          contactPhone: profile?.contactPhone ?? prev.contactPhone ?? null,
          contactCrypto: profile?.contactCrypto ?? prev.contactCrypto ?? null,
        };
      });
    } catch (error) {
      console.error('[AuthContext] Failed to refresh team info', error);
    }
  }, []);

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
        resetPassword,
        isAuthReady,
        isLoading,
        refreshTeamInfo,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
