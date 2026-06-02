/**
 * App-wide EN/ES language context. Wraps the shell in App.tsx.
 *
 * `isReady` gates GlobalLanguageSwitch until AsyncStorage load finishes so the
 * toggle does not flash the default language before the stored preference applies.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  APP_LANGUAGE_STORAGE_KEY,
  type AppLanguage,
  isAppLanguage,
} from '../lib/appLanguage';

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  isReady: boolean;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');
  /** False until persisted language is read (or read fails); avoids UI flash on cold start. */
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
        if (!cancelled && stored && isAppLanguage(stored)) {
          setLanguageState(stored);
        }
      } catch (err) {
        console.error('[LanguageProvider] failed to load language', err);
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    void AsyncStorage.setItem(APP_LANGUAGE_STORAGE_KEY, next).catch((err) => {
      console.error('[LanguageProvider] failed to persist language', err);
    });
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, isReady }),
    [language, setLanguage, isReady],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useAppLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useAppLanguage must be used within LanguageProvider');
  }
  return ctx;
}
