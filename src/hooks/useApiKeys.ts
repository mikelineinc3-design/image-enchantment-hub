import { useState, useEffect } from 'react';

const STORAGE_KEY = 'gemini_api_keys';

export interface ApiKeyConfig {
  keys: string[];
  currentIndex: number;
}

export function useApiKeys() {
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const config: ApiKeyConfig = JSON.parse(stored);
        setApiKeys(config.keys || []);
        setCurrentIndex(config.currentIndex || 0);
      } catch {
        // Invalid stored data
      }
    }
  }, []);

  const saveKeys = (keys: string[]) => {
    setApiKeys(keys);
    const config: ApiKeyConfig = { keys, currentIndex };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  };

  const addKey = (key: string) => {
    if (apiKeys.length >= 3) return false;
    if (apiKeys.includes(key)) return false;
    const newKeys = [...apiKeys, key];
    saveKeys(newKeys);
    return true;
  };

  const removeKey = (index: number) => {
    const newKeys = apiKeys.filter((_, i) => i !== index);
    saveKeys(newKeys);
    if (currentIndex >= newKeys.length) {
      setCurrentIndex(0);
    }
  };

  const rotateKey = () => {
    if (apiKeys.length === 0) return null;
    const nextIndex = (currentIndex + 1) % apiKeys.length;
    setCurrentIndex(nextIndex);
    const config: ApiKeyConfig = { keys: apiKeys, currentIndex: nextIndex };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return apiKeys[nextIndex];
  };

  const getCurrentKey = () => {
    if (apiKeys.length === 0) return null;
    return apiKeys[currentIndex];
  };

  const getNextKey = () => {
    if (apiKeys.length === 0) return null;
    // Get all keys for rotation by edge function
    return apiKeys;
  };

  return {
    apiKeys,
    addKey,
    removeKey,
    rotateKey,
    getCurrentKey,
    getNextKey,
    keyCount: apiKeys.length
  };
}
