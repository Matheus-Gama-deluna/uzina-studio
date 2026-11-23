"use client";

import { useSyncExternalStore } from "react";

const PROJECT_STORAGE_KEY = "uzina-active-project-id";
const CLIENT_STORAGE_KEY = "uzina-active-client-id";
const CONTEXT_EVENT = "uzina:select-context";

export function setActiveContext(detail: {
  clientId?: string;
  projectId?: string;
}): void {
  if (typeof window === "undefined") return;
  try {
    if (detail.clientId !== undefined) {
      window.localStorage.setItem(CLIENT_STORAGE_KEY, detail.clientId);
    }
    if (detail.projectId !== undefined) {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, detail.projectId);
    }
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent(CONTEXT_EVENT, { detail }));
}

function subscribeContext(callback: () => void): () => void {
  window.addEventListener(CONTEXT_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CONTEXT_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getStoredProjectIdSnapshot(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(
      "projectId"
    );
    if (fromUrl) return fromUrl;
    return window.localStorage.getItem(PROJECT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function getStoredClientIdSnapshot(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("clientId");
    if (fromUrl) return fromUrl;
    return window.localStorage.getItem(CLIENT_STORAGE_KEY) ?? "all";
  } catch {
    return "all";
  }
}

function getServerEmptyString(): string {
  return "";
}

function getServerAllClients(): string {
  return "all";
}

export function useActiveProjectId(): string {
  return useSyncExternalStore(
    subscribeContext,
    getStoredProjectIdSnapshot,
    getServerEmptyString
  );
}

export function useActiveClientId(): string {
  return useSyncExternalStore(
    subscribeContext,
    getStoredClientIdSnapshot,
    getServerAllClients
  );
}
