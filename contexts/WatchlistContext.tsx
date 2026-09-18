import React, { createContext, useState, useCallback, useEffect, ReactNode } from 'react';
import {
  WatchlistItem, HistoryItem, DownloadItem,
  getWatchlist, addToWatchlist, removeFromWatchlist, isInWatchlist,
  getHistory, addToHistory, clearHistory,
  getDownloads, addDownload, removeDownload,
} from '@/services/watchlistService';
import {
  getCloudWatchlist, addCloudWatchlist, removeCloudWatchlist, isInCloudWatchlist,
  getCloudHistory, addCloudHistory, clearCloudHistory,
  getCloudDownloads, addCloudDownload, removeCloudDownload,
} from '@/services/supabaseWatchlistService';
import { getSupabaseClient } from '@/template';

interface WatchlistContextType {
  watchlist: WatchlistItem[];
  history: HistoryItem[];
  downloads: DownloadItem[];
  loading: boolean;
  addItem: (item: Omit<WatchlistItem, 'addedAt'>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  checkInWatchlist: (id: string) => Promise<boolean>;
  addHistoryItem: (item: Omit<HistoryItem, 'watchedAt' | 'addedAt'>) => Promise<void>;
  clearAllHistory: () => Promise<void>;
  startDownload: (item: Omit<DownloadItem, 'downloadedAt' | 'addedAt'>) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
}

export const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

function getSafeSupabaseClient() {
  try {
    return getSupabaseClient();
  } catch (error) {
    console.warn('[WatchlistProvider] Supabase unavailable, using local storage:', error);
    return null;
  }
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('supabase_user_id');
    }
    return null;
  });

  useEffect(() => {
    const supabase = getSafeSupabaseClient();
    if (!supabase) {
      setUserId(null);
      return undefined;
    }

    supabase.auth.getSession()
      .then(({ data }) => {
        const id = data.session?.user?.id || null;
        setUserId(id);
        if (id && typeof window !== 'undefined') {
          localStorage.setItem('supabase_user_id', id);
        }
      })
      .catch(error => {
        console.warn('[WatchlistProvider] Failed to read Supabase session:', error);
        setUserId(null);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      const id = session?.user?.id || null;
      setUserId(id);
      if (id && typeof window !== 'undefined') {
        localStorage.setItem('supabase_user_id', id);
      } else if (typeof window !== 'undefined') {
        localStorage.removeItem('supabase_user_id');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      if (userId) {
        try {
          const [wl, hist, dl] = await Promise.all([
            getCloudWatchlist(userId),
            getCloudHistory(userId),
            getCloudDownloads(userId),
          ]);
          setWatchlist(wl);
          setHistory(hist);
          setDownloads(dl);
          return;
        } catch (error) {
          console.warn('[WatchlistProvider] Cloud refresh failed, falling back to local storage:', error);
        }
      }

      const [wl, hist, dl] = await Promise.all([getWatchlist(), getHistory(), getDownloads()]);
      setWatchlist(wl);
      setHistory(hist);
      setDownloads(dl);
    } catch (error) {
      console.warn('[WatchlistProvider] Failed to refresh saved media:', error);
      setWatchlist([]);
      setHistory([]);
      setDownloads([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // ─── FIX: addedAt uses Date.now() (number) ────────────────────────────
  const addItem = useCallback(async (item: Omit<WatchlistItem, 'addedAt'>) => {
    const newItem = { ...item, addedAt: Date.now() };
    setWatchlist(prev => [...prev, newItem]);
    
    try {
      if (userId) {
        await addCloudWatchlist(userId, newItem);
      } else {
        await addToWatchlist(newItem);
      }
    } catch (error) {
      setWatchlist(prev => prev.filter(i => i.id !== newItem.id));
      console.error('Failed to add item:', error);
    }
  }, [userId]);

  const removeItem = useCallback(async (id: string) => {
    const removedItem = watchlist.find(i => i.id === id);
    setWatchlist(prev => prev.filter(i => i.id !== id));
    
    try {
      if (userId) {
        await removeCloudWatchlist(userId, id);
      } else {
        await removeFromWatchlist(id);
      }
    } catch (error) {
      if (removedItem) setWatchlist(prev => [...prev, removedItem]);
      console.error('Failed to remove item:', error);
    }
  }, [userId, watchlist]);

  const checkInWatchlist = useCallback(async (id: string) => {
    try {
      if (userId) return isInCloudWatchlist(userId, id);
      return isInWatchlist(id);
    } catch (error) {
      console.warn('[WatchlistProvider] Failed to check watchlist state:', error);
      return false;
    }
  }, [userId]);

  const addHistoryItem = useCallback(async (item: Omit<HistoryItem, 'watchedAt' | 'addedAt'>) => {
    try {
      if (userId) {
        await addCloudHistory(userId, item);
        setHistory(await getCloudHistory(userId));
        return;
      }
      await addToHistory(item);
      setHistory(await getHistory());
    } catch (error) {
      console.warn('[WatchlistProvider] Failed to save watch history:', error);
    }
  }, [userId]);

  const clearAllHistory = useCallback(async () => {
    try {
      if (userId) {
        await clearCloudHistory(userId);
      } else {
        await clearHistory();
      }
      setHistory([]);
    } catch (error) {
      console.warn('[WatchlistProvider] Failed to clear watch history:', error);
    }
  }, [userId]);

  // ─── FIX: status uses 'queued' to match DownloadItem type ──────────────
  const startDownload = useCallback(async (item: Omit<DownloadItem, 'downloadedAt' | 'addedAt'>) => {
    const downloadItem = {
      ...item,
      status: 'queued' as const,
      progress: 0,
    };
    
    setDownloads(prev => [...prev, downloadItem as DownloadItem]);
    
    try {
      if (userId) {
        await addCloudDownload(userId, downloadItem as DownloadItem);
        setDownloads(await getCloudDownloads(userId));
        return;
      }
      await addDownload(downloadItem as DownloadItem);
      setDownloads(await getDownloads());
    } catch (error) {
      setDownloads(prev => prev.filter(i => i.id !== downloadItem.id));
      console.error('Failed to start download:', error);
    }
  }, [userId]);

  const cancelDownload = useCallback(async (id: string) => {
    setDownloads(prev => prev.filter(i => i.id !== id));
    try {
      if (userId) {
        await removeCloudDownload(userId, id);
      } else {
        await removeDownload(id);
      }
    } catch (error) {
      console.error('Failed to cancel download:', error);
    }
  }, [userId]);

  return (
    <WatchlistContext.Provider
      value={{
        watchlist, history, downloads, loading,
        addItem, removeItem, checkInWatchlist,
        addHistoryItem, clearAllHistory,
        startDownload, cancelDownload, refreshAll,
      }}
    >
      {children}
    </WatchlistContext.Provider>
  );
}
