import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { ApiProvider } from '@/hooks/useApiKeys';

interface ApiKeyManagerProps {
  geminiKeys: string[];
  openaiKeys: string[];
  onAddKey: (provider: ApiProvider, key: string) => boolean;
  onRemoveKey: (provider: ApiProvider, index: number) => void;
}

export function ApiKeyManager({ geminiKeys, openaiKeys, onAddKey, onRemoveKey }: ApiKeyManagerProps) {
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [newOpenaiKey, setNewOpenaiKey] = useState('');
  const [showGeminiKeys, setShowGeminiKeys] = useState(false);
  const [showOpenaiKeys, setShowOpenaiKeys] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleAddKey = (provider: ApiProvider, key: string, setKey: (v: string) => void) => {
    if (!key.trim()) {
      toast.error('Please enter an API key');
      return;
    }
    if (key.length < 20) {
      toast.error('Invalid API key format');
      return;
    }
    const success = onAddKey(provider, key.trim());
    if (success) {
      setKey('');
      toast.success(`${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key added`);
    } else {
      toast.error('Cannot add more keys or key already exists');
    }
  };

  const maskKey = (key: string, show: boolean) => {
    if (show) return key;
    return key.slice(0, 8) + '...' + key.slice(-4);
  };

  const totalKeys = geminiKeys.length + openaiKeys.length;

  return (
    <div className="p-4 rounded-xl gradient-card border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Key className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">
          AI API Keys ({totalKeys} total)
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {isExpanded ? 'Click to collapse' : 'Click to expand'}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Add API keys from multiple providers. Keys rotate automatically to reduce rate limits.
            Gemini keys are used for image enhancement, OpenAI keys for metadata generation.
          </p>

          {/* Gemini Section */}
          <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary">Gemini ({geminiKeys.length}/3)</span>
              {geminiKeys.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowGeminiKeys(!showGeminiKeys)}
                  className="h-6 px-2"
                >
                  {showGeminiKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </Button>
              )}
            </div>
            
            {geminiKeys.map((key, index) => (
              <div key={`gemini-${index}`} className="flex items-center gap-2 p-2 rounded-lg bg-background/50">
                <code className="text-xs flex-1 truncate">{maskKey(key, showGeminiKeys)}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onRemoveKey('gemini', index);
                    toast.info('Gemini API key removed');
                  }}
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}

            {geminiKeys.length < 3 && (
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="Enter Gemini API key"
                  value={newGeminiKey}
                  onChange={(e) => setNewGeminiKey(e.target.value)}
                  className="text-xs h-8"
                />
                <Button
                  onClick={() => handleAddKey('gemini', newGeminiKey, setNewGeminiKey)}
                  size="sm"
                  variant="outline"
                  className="h-8"
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            )}
            
            <p className="text-xs text-muted-foreground">
              Get keys from{' '}
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Google AI Studio
              </a>
            </p>
          </div>

          {/* OpenAI Section */}
          <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-green-500">OpenAI ({openaiKeys.length}/3)</span>
              {openaiKeys.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowOpenaiKeys(!showOpenaiKeys)}
                  className="h-6 px-2"
                >
                  {showOpenaiKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </Button>
              )}
            </div>
            
            {openaiKeys.map((key, index) => (
              <div key={`openai-${index}`} className="flex items-center gap-2 p-2 rounded-lg bg-background/50">
                <code className="text-xs flex-1 truncate">{maskKey(key, showOpenaiKeys)}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onRemoveKey('openai', index);
                    toast.info('OpenAI API key removed');
                  }}
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}

            {openaiKeys.length < 3 && (
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="Enter OpenAI API key"
                  value={newOpenaiKey}
                  onChange={(e) => setNewOpenaiKey(e.target.value)}
                  className="text-xs h-8"
                />
                <Button
                  onClick={() => handleAddKey('openai', newOpenaiKey, setNewOpenaiKey)}
                  size="sm"
                  variant="outline"
                  className="h-8"
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            )}
            
            <p className="text-xs text-muted-foreground">
              Get keys from{' '}
              <a 
                href="https://platform.openai.com/api-keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                OpenAI Platform
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
