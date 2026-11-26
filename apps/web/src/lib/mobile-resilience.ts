"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface OfflineDraftItem {
  id: string;
  scopeKey: string;
  kind: "text" | "audio";
  text: string;
  audioBlob?: Blob;
  audioMimeType?: string;
  createdAt: string;
}

const DB_NAME = "uzina-offline-queue";
const STORE_NAME = "drafts";
const DB_VERSION = 1;
const FALLBACK_STORAGE_KEY = "uzina-offline-drafts-v1";

function openDraftDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readLocalStorageFallback(): OfflineDraftItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineDraftItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalStorageFallback(items: OfflineDraftItem[]): void {
  if (typeof window === "undefined") return;
  try {
    const serializable = items.map(({ audioBlob: _blob, ...rest }) => rest);
    window.localStorage.setItem(
      FALLBACK_STORAGE_KEY,
      JSON.stringify(serializable)
    );
  } catch {
    // ignore storage quota errors
  }
}

export async function listOfflineDraftsCount(): Promise<number> {
  const db = await openDraftDb();
  if (!db) {
    return readLocalStorageFallback().length;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => resolve(countReq.result ?? 0);
      countReq.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export function useVisualViewportKeyboard(): {
  keyboardHeight: number;
  isKeyboardOpen: boolean;
} {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const vv = window.visualViewport;
    const update = () => {
      const diff = Math.max(
        0,
        Math.round(window.innerHeight - vv.height - vv.offsetTop)
      );
      setKeyboardHeight(diff > 60 ? diff : 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return {
    keyboardHeight,
    isKeyboardOpen: keyboardHeight > 0,
  };
}

export function useVisibilityReconnect(
  onResume: () => void,
  enabled = true
): void {
  const callbackRef = useRef(onResume);

  useEffect(() => {
    callbackRef.current = onResume;
  }, [onResume]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        callbackRef.current();
      }
    };
    const handleOnline = () => {
      callbackRef.current();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        callbackRef.current();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [enabled]);
}

function subscribeOnlineStatus(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOfflineDraftQueue(scopeKey: string) {
  const [drafts, setDrafts] = useState<OfflineDraftItem[]>([]);
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    () => window.navigator.onLine,
    () => true
  );

  const loadDrafts = useCallback(async () => {
    const db = await openDraftDb();
    if (!db) {
      setDrafts(
        readLocalStorageFallback().filter((item) => item.scopeKey === scopeKey)
      );
      return;
    }

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const idx = store.index("scopeKey");
        const req = idx.getAll(scopeKey);
        req.onsuccess = () => {
          const list = (req.result as OfflineDraftItem[]) ?? [];
          list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          setDrafts(list);
          resolve();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }, [scopeKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    void openDraftDb().then((db) => {
      if (cancelled) return;
      if (!db) {
        setDrafts(
          readLocalStorageFallback().filter((item) => item.scopeKey === scopeKey)
        );
        return;
      }
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const idx = store.index("scopeKey");
        const req = idx.getAll(scopeKey);
        req.onsuccess = () => {
          if (cancelled) return;
          const list = (req.result as OfflineDraftItem[]) ?? [];
          list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          setDrafts(list);
        };
      } catch {
        // noop
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  const enqueueDraft = useCallback(
    async (
      input: Omit<OfflineDraftItem, "id" | "scopeKey" | "createdAt">
    ): Promise<OfflineDraftItem> => {
      const item: OfflineDraftItem = {
        ...input,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        scopeKey,
        createdAt: new Date().toISOString(),
      };

      const db = await openDraftDb();
      if (!db) {
        const current = readLocalStorageFallback();
        writeLocalStorageFallback([...current, item]);
        setDrafts((prev) => [...prev, item]);
        return item;
      }

      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put(item);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });

      await loadDrafts();
      return item;
    },
    [loadDrafts, scopeKey]
  );

  const removeDraft = useCallback(
    async (id: string): Promise<void> => {
      const db = await openDraftDb();
      if (!db) {
        const remaining = readLocalStorageFallback().filter(
          (item) => item.id !== id
        );
        writeLocalStorageFallback(remaining);
        setDrafts((prev) => prev.filter((item) => item.id !== id));
        return;
      }

      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });

      setDrafts((prev) => prev.filter((item) => item.id !== id));
    },
    []
  );

  return {
    drafts,
    isOnline,
    enqueueDraft,
    removeDraft,
    reloadDrafts: loadDrafts,
  };
}

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (
      !active ||
      typeof navigator === "undefined" ||
      !("wakeLock" in navigator)
    ) {
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Browsers may reject wakeLock without user gesture or low battery
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && active) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (sentinelRef.current) {
        void sentinelRef.current.release().catch(() => undefined);
        sentinelRef.current = null;
      }
    };
  }, [active]);
}
