import React, { createContext, useContext, useState, useEffect } from 'react';
import { EmailVerificationChallenge, User } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  login: (u: string, p: string) => Promise<{ success: boolean; message?: string; verification?: EmailVerificationChallenge }>;
  /** P22: finish signing in with the session returned by a successful email verification. */
  completeSignIn: (token: string, user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('carbonroute_token');
      if (token) {
        try {
          const res = await api.getMe();
          if (res.success && res.user) {
            setUser(res.user);
          } else {
            // P22: api.getMe removes the token only when the server rejected it; a slow or
            // unreachable server (e.g. a cold start) keeps it, so a refresh does not sign out.
            setUser(null);
          }
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const res = await api.login(username, password);
      if (res.success && res.token && res.user) {
        localStorage.setItem('carbonroute_token', res.token);
        setUser(res.user);
        return { success: true, message: 'Login successful' };
      }
      return { success: false, message: res.message || 'Login failed', verification: res.verification };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error during login' };
    }
  };

  const completeSignIn = (token: string, signedIn: User) => {
    localStorage.setItem('carbonroute_token', token);
    setUser(signedIn);
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore errors on logout
    }
    localStorage.removeItem('carbonroute_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin',
        loading,
        login,
        completeSignIn,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
