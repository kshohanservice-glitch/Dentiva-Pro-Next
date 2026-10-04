import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { SessionUser, SettingsDTO, ActivationStatus } from '../../shared/types';
import type { PublicSettings } from '../../shared/ipc';

export type BootPhase = 'booting' | 'activation' | 'setup' | 'auth' | 'ready';

interface AppState {
  phase: BootPhase;
  user: SessionUser | null;
  locked: boolean;
  settings: SettingsDTO | null;
  system: { version: string; schemaVersion: number; dataDir: string; platform: string; demo: boolean } | null;
  activation: ActivationStatus | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; reason?: string; retryAfterMs?: number }>;
  logout: () => Promise<void>;
  lock: () => void;
  unlock: (password: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  can: (permission: string) => boolean;
  completeSetup: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('App provider missing');
  return ctx;
}

/** Convenience: permission check from current session. */
export function useCan(): (permission: string) => boolean {
  return useApp().can;
}

export function AppProvider(props: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<BootPhase>('booting');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [locked, setLocked] = useState(false);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [system, setSystem] = useState<AppState['system']>(null);
  const [activation, setActivation] = useState<ActivationStatus | null>(null);
  const navigate = useNavigate();
  const lastActivityPing = useRef<number>(0);

  const refreshSettings = useCallback(async () => {
    try {
      const s = (await api['settings/get']()) as SettingsDTO;
      if (s && (s as any).clinic && (s as any).security) setSettings(s);
    } catch {
      /* non-fatal */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [sys, act, setup, session] = await Promise.all([
        api['system/info'](),
        api['activation/status'](),
        api['setup/status'](),
        api['auth/session'](),
      ]);
      setSystem(sys);
      setActivation(act);
      setUser(session);
      if (sys.demo) {
        setPhase('ready');
        void refreshSettings();
      } else if (!act.activated) setPhase('activation');
      else if (setup.needsSetup) setPhase('setup');
      else if (!session) setPhase('auth');
      else {
        setPhase('ready');
        void refreshSettings();
      }
    } catch (err) {
      console.error('Boot failed', err);
      setPhase('auth');
    }
  }, [refreshSettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Lock subscription
  useEffect(() => {
    const off = api.onLock(() => setLocked(true));
    const off2 = api.onSessionExpired(() => {
      setUser(null);
      setLocked(false);
      setSettings(null);
      setPhase((p) => (p === 'ready' ? 'auth' : p));
      navigate('/');
    });
    return () => {
      off();
      off2();
    };
  }, [navigate]);

  // Activity ping (resets auto-lock timer only on genuine user interaction)
  useEffect(() => {
    const onUserActivity = () => {
      if (!user || locked) return;
      const now = Date.now();
      if (now - lastActivityPing.current < 15_000) return;
      lastActivityPing.current = now;
      void api['system/activity']().catch(() => undefined);
    };
    window.addEventListener('pointerdown', onUserActivity, { passive: true });
    window.addEventListener('keydown', onUserActivity);
    return () => {
      window.removeEventListener('pointerdown', onUserActivity);
      window.removeEventListener('keydown', onUserActivity);
    };
  }, [user, locked]);

  // Appearance
  useEffect(() => {
    const app = settings?.appearance;
    const theme = app?.theme ?? 'light';
    const resolved =
      theme === 'system'
        ? window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.density = app?.density ?? 'comfortable';
    document.documentElement.dataset.motion = app?.animations === false ? 'off' : 'on';
  }, [settings?.appearance]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api['auth/login']({ username, password });
    if (res.ok) {
      setUser(res.user);
      setLocked(false);
      setPhase('ready');
      await refreshSettings();
      return { ok: true };
    }
    return { ok: false, reason: res.reason, retryAfterMs: res.retryAfterMs };
  }, [refreshSettings]);

  const logout = useCallback(async () => {
    try {
      await api['auth/logout']();
    } finally {
      setUser(null);
      setLocked(false);
      setSettings(null);
      setPhase('auth');
      navigate('/');
    }
  }, [navigate]);

  const lock = useCallback(() => {
    void api['system/lock']().catch(() => undefined);
    setLocked(true);
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      const res = await api['auth/unlock'](password);
      if (res.ok) {
        setLocked(false);
        void api['system/activity']().catch(() => undefined);
        return true;
      }
      return false;
    },
    [],
  );

  const completeSetup = useCallback(async () => {
    setActivation({ activated: true, state: 'activated' });
    setPhase('auth');
    await refresh();
  }, [refresh]);

  const can = useCallback(
    (permission: string) => !!user && user.permissions.includes(permission as any),
    [user],
  );

  const value = useMemo<AppState>(
    () => ({ phase, user, locked, settings, system, activation, login, logout, lock, unlock, refresh, refreshSettings, can, completeSetup }),
    [phase, user, locked, settings, system, activation, login, logout, lock, unlock, refresh, refreshSettings, can, completeSetup],
  );
 
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export type { PublicSettings };
