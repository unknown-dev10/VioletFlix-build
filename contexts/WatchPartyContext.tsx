import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { watchPartyService } from '@/services/firebase';
import { useAuth } from '@/template';

interface WatchPartyState {
  partyCode: string | null;
  isHost: boolean;
  memberCount: number;
  currentTime: number;
  isPaused: boolean;
  isActive: boolean;
  members: Record<string, { joinedAt: number; isHost: boolean }>;
}

interface WatchPartyContextValue extends WatchPartyState {
  createParty: (mediaId: string) => Promise<string>;
  joinParty: (code: string) => Promise<boolean>;
  leaveParty: () => Promise<void>;
  syncPlayback: (time: number, paused: boolean) => void;
}

const WatchPartyContext = createContext<WatchPartyContextValue | null>(null);

export function WatchPartyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<WatchPartyState>({
    partyCode: null,
    isHost: false,
    memberCount: 0,
    currentTime: 0,
    isPaused: true,
    isActive: false,
    members: {},
  });

  // ─── Listen to Firebase real-time updates ──────────────────────────────
  useEffect(() => {
    if (!state.partyCode || !user) return;

    const unsubscribe = watchPartyService.listenToParty(state.partyCode, (data) => {
      if (!data) {
        setState((prev) => ({
          ...prev,
          isActive: false,
          partyCode: null,
          memberCount: 0,
          members: {},
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        memberCount: Object.keys(data.members || {}).length,
        currentTime: data.currentTime || 0,
        isPaused: data.paused ?? true,
        members: data.members || {},
      }));
    });

    return () => unsubscribe();
  }, [state.partyCode, user]);

  // ─── Create Party ───────────────────────────────────────────────────────
  const createParty = useCallback(
    async (mediaId: string) => {
      if (!user) throw new Error('Must be logged in to create a party');

      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      await watchPartyService.createParty(code, mediaId, user.id);

      setState({
        partyCode: code,
        isHost: true,
        memberCount: 1,
        currentTime: 0,
        isPaused: true,
        isActive: true,
        members: { [user.id]: { joinedAt: Date.now(), isHost: true } },
      });

      return code;
    },
    [user]
  );

  // ─── Join Party ─────────────────────────────────────────────────────────
  const joinParty = useCallback(
    async (code: string) => {
      if (!user) throw new Error('Must be logged in to join a party');

      try {
        const data = await watchPartyService.joinParty(code, user.id);
        setState({
          partyCode: code,
          isHost: false,
          memberCount: Object.keys(data.members || {}).length,
          currentTime: data.currentTime || 0,
          isPaused: data.paused ?? true,
          isActive: true,
          members: data.members || {},
        });
        return true;
      } catch (error) {
        console.error('Failed to join party:', error);
        return false;
      }
    },
    [user]
  );

  // ─── Leave Party ────────────────────────────────────────────────────────
  const leaveParty = useCallback(async () => {
    if (!state.partyCode || !user) return;

    await watchPartyService.leaveParty(state.partyCode, user.id);
    setState({
      partyCode: null,
      isHost: false,
      memberCount: 0,
      currentTime: 0,
      isPaused: true,
      isActive: false,
      members: {},
    });
  }, [state.partyCode, user]);

  // ─── Sync Playback (Host only) ─────────────────────────────────────────
  const syncPlayback = useCallback(
    (time: number, paused: boolean) => {
      if (!state.partyCode || !state.isHost) return;
      watchPartyService.syncPlayback(state.partyCode, time, paused);
    },
    [state.partyCode, state.isHost]
  );

  // ─── Context Value ──────────────────────────────────────────────────────
  const contextValue: WatchPartyContextValue = {
    ...state,
    createParty,
    joinParty,
    leaveParty,
    syncPlayback,
  };

  return (
    <WatchPartyContext.Provider value={contextValue}>
      {children}
    </WatchPartyContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useWatchParty() {
  const ctx = useContext(WatchPartyContext);
  if (!ctx) {
    throw new Error('useWatchParty must be used within a WatchPartyProvider');
  }
  return ctx;
}
