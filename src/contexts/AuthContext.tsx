import React, { createContext, useContext, useState, ReactNode } from 'react';
import { User } from '@/types';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, teamName: string) => Promise<void>;
  logout: () => void;
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

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setUser({
        id: '1',
        username: 'Menajer',
        email,
        teamName: 'Takımım',
        teamLogo: '⚽',
        connectedAccounts: { google: false, apple: false }
      });
      setIsLoading(false);
    }, 1000);
  };

  const register = async (email: string, password: string, teamName: string) => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setUser({
        id: '1',
        username: 'Menajer',
        email,
        teamName,
        teamLogo: '⚽',
        connectedAccounts: { google: false, apple: false }
      });
      setIsLoading(false);
    }, 1000);
  };

  const logout = () => {
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};