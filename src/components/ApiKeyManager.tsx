import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { ApiProvider } from '@/hooks/useApiKeys';

interface ApiKeyManagerProps {
  geminiKeys: string[];
  openaiKeys: string[];
  groqKeys: string[];
  cloudconvertKeys: string[];
  onAddKey: (provider: ApiProvider, key: string) => boolean;
  onRemoveKey: (provider: ApiProvider, index: number) => void;
}

const PROVIDER_META: Record<ApiProvider, { label: string; limit: number; color: string; help: { href: string; label: string } }> = {
  gemini: { label: 'Gemini', limit: 5, color: 'text-primary', help: { href: 'https://aistudio.google.com/app/apikey', label: 'Google AI Studio' } },
  openai: { label: 'OpenAI', limit: 3, color: 'text-green-500', help: { href: 'https://platform.openai.com/api-keys', label: 'OpenAI Platform' } },
  groq: { label: 'Groq', limit: 3, color: 'text-orange-500', help: { href: 'https://console.groq.com/keys', label: 'Groq Console' } },
  cloudconvert: { label: 'CloudConvert', limit: 10, color: 'text-blue-500', help: { href: 'https://cloudconvert.com/dashboard/api/v2/keys', label: 'CloudConvert Dashboard' } },
};

interface ProviderSectionProps {
  provider: ApiProvider;
  keys: string[];
  onAddKey: (provider: ApiProvider, key: string) => boolean;
  onRemoveKey: (provider: ApiProvider, index: number) => void;
}

function ProviderSection({ provider, keys, onAddKey, onRemoveKey }: ProviderSectionProps) {
  const meta = PROVIDER_META[provider];
  const [newKey, setNewKey] = useState('');
  const [show, setShow] = useState(false);

  const maskKey = (key: string) => show ? key : key.slice(0, 8) + '...' + key.slice(-4);

  const handleAdd = () => {
    if (!newKey.trim()) return toast.error('Please enter an API key');
    if (newKey.length < 20) return toast.error('Invalid API key format');
    const success = onAddKey(provider, newKey.trim());
    if (success) {
      setNewKey('');
      toast.success(`${meta.label} API key added`);
    } else {
      toast.error('Cannot add more keys or key already exists');
    }
  };

  return (
    <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-border/50">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${meta.color}`}>{meta.label} ({keys.length}/{meta.limit})</span>
        {keys.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShow(!show)} className="h-6 px-2">
            {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </Button>
        )}
      </div>

      {keys.map((key, index) => (
        <div key={`${provider}-${index}`} className="flex items-center gap-2 p-2 rounded-lg bg-background/50">
          <code className="text-xs flex-1 truncate">{maskKey(key)}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { onRemoveKey(provider, index); toast.info(`${meta.label} API key removed`); }}
            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}

      {keys.length < meta.limit && (
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={`Enter ${meta.label} API key`}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="text-xs h-8"
          />
          <Button onClick={handleAdd} size="sm" variant="outline" className="h-8">
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Get keys from{' '}
        <a href={meta.help.href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {meta.help.label}
        </a>
      </p>
      {provider === 'cloudconvert' && (
        <p className="text-xs text-muted-foreground italic">
          Used only as a fallback to rasterize EPS files with no embedded preview. Add multiple
          keys/accounts to raise your daily conversion limit.
        </p>
      )}
    </div>
  );
}

export function ApiKeyManager({ geminiKeys, openaiKeys, groqKeys, cloudconvertKeys, onAddKey, onRemoveKey }: ApiKeyManagerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const totalKeys = geminiKeys.length + openaiKeys.length + groqKeys.length + cloudconvertKeys.length;

  return (
    <div className="p-4 rounded-xl gradient-card border border-border">
      <button onClick={() => setIsExpanded(!isExpanded)} className="flex items-center gap-2 w-full text-left">
        <Key className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">AI API Keys ({totalKeys} total)</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {isExpanded ? 'Click to collapse' : 'Click to expand'}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Add API keys from multiple providers. Keys rotate automatically to reduce rate limits.
            Gemini keys are used for image enhancement; OpenAI and Groq keys for metadata generation.
            CloudConvert is used only to rasterize EPS files with no embedded preview.
          </p>
          <ProviderSection provider="gemini" keys={geminiKeys} onAddKey={onAddKey} onRemoveKey={onRemoveKey} />
          <ProviderSection provider="openai" keys={openaiKeys} onAddKey={onAddKey} onRemoveKey={onRemoveKey} />
          <ProviderSection provider="groq" keys={groqKeys} onAddKey={onAddKey} onRemoveKey={onRemoveKey} />
          <ProviderSection provider="cloudconvert" keys={cloudconvertKeys} onAddKey={onAddKey} onRemoveKey={onRemoveKey} />
        </div>
      )}
    </div>
  );
}
