import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface MiniPlayerState {
  isVisible: boolean;
  url: string | null;
  title: string | null;
  currentTime: number;
  isPaused: boolean;
  id: string | number | null;
}

interface MiniPlayerContextValue extends MiniPlayerState {
  openMiniPlayer: (data: Omit<MiniPlayerState, 'isVisible' | 'currentTime' | 'isPaused'>) => void;
  updatePlayback: (time: number, paused: boolean) => void;
  closeMiniPlayer: () => void;
}

const MiniPlayerContext = createContext<MiniPlayerContextValue | undefined>(undefined);

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MiniPlayerState>({
    isVisible: false,
    url: null,
    title: null,
    currentTime: 0,
    isPaused: true,
    id: null,
  });

  const openMiniPlayer = useCallback((data: Omit<MiniPlayerState, 'isVisible' | 'currentTime' | 'isPaused'>) => {
    setState({ ...data, isVisible: true, currentTime: 0, isPaused: true });
  }, []);

  const updatePlayback = useCallback((time: number, paused: boolean) => {
    setState((prev) => (prev.isVisible ? { ...prev, currentTime: time, isPaused: paused } : prev));
  }, []);

  const closeMiniPlayer = useCallback(() => {
    setState((prev) => ({ ...prev, isVisible: false, url: null }));
  }, []);

  return (
    <MiniPlayerContext.Provider value={{ ...state, openMiniPlayer, updatePlayback, closeMiniPlayer }}>
      {children}
    </MiniPlayerContext.Provider>
  );
}

export function useMiniPlayer() {
  const ctx = useContext(MiniPlayerContext);
  if (!ctx) throw new Error('useMiniPlayer must be used within MiniPlayerProvider');
  return ctx;
}
