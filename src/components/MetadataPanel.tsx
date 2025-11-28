import { MicrostockMetadata } from '@/types/photo';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface MetadataPanelProps {
  metadata?: MicrostockMetadata;
}

export function MetadataPanel({ metadata }: MetadataPanelProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!metadata) {
    return (
      <div className="p-4 rounded-lg bg-muted/30 border border-border text-center">
        <p className="text-sm text-muted-foreground">
          Metadata will be generated after enhancement
        </p>
      </div>
    );
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success(`${field} copied to clipboard`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const CopyButton = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => copyToClipboard(text, field)}
      className="p-1 rounded hover:bg-primary/10 transition-colors"
      title={`Copy ${field}`}
    >
      {copiedField === field ? (
        <Check className="w-3.5 h-3.5 text-primary" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
      )}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Filename */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">Suggested Filename</span>
          <CopyButton text={metadata.filename} field="Filename" />
        </div>
        <p className="text-sm font-mono text-foreground break-all">{metadata.filename}</p>
      </div>

      {/* Title */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            Title ({metadata.title.length}/200 chars)
          </span>
          <CopyButton text={metadata.title} field="Title" />
        </div>
        <p className="text-sm text-foreground">{metadata.title}</p>
      </div>

      {/* Keywords */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            Keywords ({metadata.keywords.split(',').length} tags)
          </span>
          <CopyButton text={metadata.keywords} field="Keywords" />
        </div>
        <p className="text-xs text-foreground leading-relaxed">{metadata.keywords}</p>
      </div>

      {/* Categories */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Adobe Stock</span>
            <CopyButton text={metadata.adobeCategory} field="Adobe Category" />
          </div>
          <p className="text-sm text-foreground">{metadata.adobeCategory}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Shutterstock</span>
            <CopyButton text={metadata.shutterstockCategory} field="Shutterstock Category" />
          </div>
          <p className="text-sm text-foreground">{metadata.shutterstockCategory}</p>
        </div>
      </div>
    </div>
  );
}
