import { useState, useEffect } from 'react';

const STORAGE_KEY = 'ai_api_keys';

export type ApiProvider = 'gemini' | 'openai';

export interface ApiKeyConfig {
  gemini: string[];
  openai: string[];
  currentIndex: {
    gemini: number;
    openai: number;
  };
}

const defaultConfig: ApiKeyConfig = {
  gemini: [],
  openai: [],
  currentIndex: { gemini: 0, openai: 0 }
};

export function useApiKeys() {
  const [config, setConfig] = useState<ApiKeyConfig>(defaultConfig);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Handle legacy format (single array of keys)
        if (Array.isArray(parsed.keys)) {
          setConfig({
            gemini: parsed.keys,
            openai: [],
            currentIndex: { gemini: parsed.currentIndex || 0, openai: 0 }
          });
        } else {
          setConfig({
            gemini: parsed.gemini || [],
            openai: parsed.openai || [],
            currentIndex: parsed.currentIndex || { gemini: 0, openai: 0 }
          });
        }
      } catch {
        // Invalid stored data
      }
    }
  }, []);

  const saveConfig = (newConfig: ApiKeyConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
  };

  const addKey = (provider: ApiProvider, key: string) => {
    if (config[provider].length >= 3) return false;
    if (config[provider].includes(key)) return false;
    const newConfig = {
      ...config,
      [provider]: [...config[provider], key]
    };
    saveConfig(newConfig);
    return true;
  };

  const removeKey = (provider: ApiProvider, index: number) => {
    const newKeys = config[provider].filter((_, i) => i !== index);
    const newConfig = {
      ...config,
      [provider]: newKeys,
      currentIndex: {
        ...config.currentIndex,
        [provider]: config.currentIndex[provider] >= newKeys.length ? 0 : config.currentIndex[provider]
      }
    };
    saveConfig(newConfig);
  };

  const getKeys = (provider: ApiProvider) => {
    return config[provider];
  };

  const getAllKeys = () => {
    return {
      gemini: config.gemini,
      openai: config.openai
    };
  };

  const getKeyCount = (provider: ApiProvider) => {
    return config[provider].length;
  };

  const getTotalKeyCount = () => {
    return config.gemini.length + config.openai.length;
  };

  return {
    config,
    addKey,
    removeKey,
    getKeys,
    getAllKeys,
    getKeyCount,
    getTotalKeyCount
  };
}
