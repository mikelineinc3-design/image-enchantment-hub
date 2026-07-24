import { useState, useEffect } from 'react';

const STORAGE_KEY = 'ai_api_keys';

export type ApiProvider = 'gemini' | 'openai' | 'groq' | 'cloudconvert' | 'openrouter';

export interface ApiKeyConfig {
  gemini: string[];
  openai: string[];
  groq: string[];
  cloudconvert: string[];
  openrouter: string[];
  currentIndex: {
    gemini: number;
    openai: number;
    groq: number;
    cloudconvert: number;
    openrouter: number;
  };
}

const PROVIDER_LIMITS: Record<ApiProvider, number> = {
  gemini: 5,
  openai: 3,
  groq: 3,
  cloudconvert: 10,
  openrouter: 5,
};

const defaultConfig: ApiKeyConfig = {
  gemini: [],
  openai: [],
  groq: [],
  cloudconvert: [],
  openrouter: [],
  currentIndex: { gemini: 0, openai: 0, groq: 0, cloudconvert: 0, openrouter: 0 }
};

export function useApiKeys() {
  const [config, setConfig] = useState<ApiKeyConfig>(defaultConfig);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.keys)) {
          setConfig({
            gemini: parsed.keys,
            openai: [],
            groq: [],
            cloudconvert: [],
            openrouter: [],
            currentIndex: { gemini: parsed.currentIndex || 0, openai: 0, groq: 0, cloudconvert: 0, openrouter: 0 }
          });
        } else {
          setConfig({
            gemini: parsed.gemini || [],
            openai: parsed.openai || [],
            groq: parsed.groq || [],
            cloudconvert: parsed.cloudconvert || [],
            openrouter: parsed.openrouter || [],
            currentIndex: {
              gemini: parsed.currentIndex?.gemini || 0,
              openai: parsed.currentIndex?.openai || 0,
              groq: parsed.currentIndex?.groq || 0,
              cloudconvert: parsed.currentIndex?.cloudconvert || 0,
              openrouter: parsed.currentIndex?.openrouter || 0,
            }
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
    if (config[provider].length >= PROVIDER_LIMITS[provider]) return false;
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

  const getKeys = (provider: ApiProvider) => config[provider];
  const getAllKeys = () => ({
    gemini: config.gemini,
    openai: config.openai,
    groq: config.groq,
    cloudconvert: config.cloudconvert,
    openrouter: config.openrouter,
  });
  const getKeyCount = (provider: ApiProvider) => config[provider].length;
  const getTotalKeyCount = () =>
    config.gemini.length + config.openai.length + config.groq.length + config.cloudconvert.length + config.openrouter.length;
  const getKeyLimit = (provider: ApiProvider) => PROVIDER_LIMITS[provider];

  return {
    config,
    addKey,
    removeKey,
    getKeys,
    getAllKeys,
    getKeyCount,
    getTotalKeyCount,
    getKeyLimit,
  };
}
