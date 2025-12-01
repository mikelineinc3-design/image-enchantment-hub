import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Key, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

interface ApiKeyManagerProps {
  apiKeys: string[];
  onAddKey: (key: string) => boolean;
  onRemoveKey: (index: number) => void;
}

export function ApiKeyManager({ apiKeys, onAddKey, onRemoveKey }: ApiKeyManagerProps) {
  const [newKey, setNewKey] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleAddKey = () => {
    if (!newKey.trim()) {
      toast.error('Please enter an API key');
      return;
    }
    if (newKey.length < 20) {
      toast.error('Invalid API key format');
      return;
    }
    const success = onAddKey(newKey.trim());
    if (success) {
      setNewKey('');
      toast.success('API key added');
    } else {
      toast.error('Cannot add more keys or key already exists');
    }
  };

  const maskKey = (key: string) => {
    if (showKeys) return key;
    return key.slice(0, 8) + '...' + key.slice(-4);
  };

  return (
    <div className="p-4 rounded-xl gradient-card border border-border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <Key className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">
          Gemini API Keys ({apiKeys.length}/3)
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {isExpanded ? 'Click to collapse' : 'Click to expand'}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Add up to 3 free Gemini API keys to rotate and reduce rate limits. 
            Keys are stored locally and rotated automatically.
          </p>

          {apiKeys.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Your keys:</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowKeys(!showKeys)}
                  className="h-6 px-2"
                >
                  {showKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </Button>
              </div>
              {apiKeys.map((key, index) => (
                <div key={index} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                  <code className="text-xs flex-1 truncate">{maskKey(key)}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onRemoveKey(index);
                      toast.info('API key removed');
                    }}
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {apiKeys.length < 3 && (
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Enter Gemini API key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="text-xs h-8"
              />
              <Button
                onClick={handleAddKey}
                size="sm"
                variant="outline"
                className="h-8"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Get free API keys from{' '}
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
      )}
    </div>
  );
}
