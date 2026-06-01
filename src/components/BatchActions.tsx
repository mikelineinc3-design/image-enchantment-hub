import { FilterType, FileType, MetadataMode } from '@/types/photo';
import { FilterSelector } from './FilterSelector';
import { FileTypeSelector } from './FileTypeSelector';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Download, Loader2, Database, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BatchActionsProps {
  photoCount: number;
  readyCount: number;
  selectedFilters: FilterType[];
  selectedFileType: FileType;
  upscaleEnabled: boolean;
  metadataMode: MetadataMode;
  customPrompt: string;
  onFilterChange: (filters: FilterType[]) => void;
  onFileTypeChange: (fileType: FileType) => void;
  onUpscaleChange: (enabled: boolean) => void;
  onMetadataModeChange: (mode: MetadataMode) => void;
  onCustomPromptChange: (prompt: string) => void;
  onEnhanceAll: () => void;
  onDownloadAll: () => void;
  isEnhancing: boolean;
}

export function BatchActions({
  photoCount,
  readyCount,
  selectedFilters,
  selectedFileType,
  upscaleEnabled,
  metadataMode,
  customPrompt,
  onFilterChange,
  onFileTypeChange,
  onUpscaleChange,
  onMetadataModeChange,
  onCustomPromptChange,
  onEnhanceAll,
  onDownloadAll,
  isEnhancing,
}: BatchActionsProps) {
  if (photoCount === 0) return null;

  return (
    <div className="mb-6 p-4 rounded-xl gradient-card border border-border space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Batch File Type:</span>
            <FileTypeSelector
              selected={selectedFileType}
              onSelect={onFileTypeChange}
              disabled={isEnhancing}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Batch Filters (select multiple):</span>
            <FilterSelector
              selected={selectedFilters}
              onSelect={onFilterChange}
              disabled={isEnhancing}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Upscale to 5MP:</span>
            <div className="flex items-center gap-2 h-9">
              <Switch
                id="upscale-toggle"
                checked={upscaleEnabled}
                onCheckedChange={onUpscaleChange}
                disabled={isEnhancing}
              />
              <Label htmlFor="upscale-toggle" className="text-sm">
                {upscaleEnabled ? 'On' : 'Off'}
              </Label>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {readyCount}/{photoCount} ready
          </span>

          <Button onClick={onEnhanceAll} disabled={isEnhancing} variant="glow" size="sm">
            {isEnhancing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Enhance All
              </>
            )}
          </Button>

          <Button onClick={onDownloadAll} disabled={readyCount === 0} variant="outline" size="sm">
            <Download className="w-4 h-4" />
            Download All
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Metadata Generation Mode:</span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={metadataMode === 'default' ? 'default' : 'outline'}
              onClick={() => onMetadataModeChange('default')}
              disabled={isEnhancing}
              className={cn(metadataMode === 'default' && 'gradient-primary text-primary-foreground')}
            >
              <FileText className="w-4 h-4" />
              Default Metadata
            </Button>
            <Button
              type="button"
              size="sm"
              variant={metadataMode === 'data' ? 'default' : 'outline'}
              onClick={() => onMetadataModeChange('data')}
              disabled={isEnhancing}
              className={cn(metadataMode === 'data' && 'gradient-primary text-primary-foreground')}
            >
              <Database className="w-4 h-4" />
              Data
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {metadataMode === 'data'
              ? 'Uses Shutterstock SEO + AI training value prompt (literal title, 40-50 tags, AI training note).'
              : 'Standard microstock metadata for Adobe Stock and Shutterstock.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="custom-prompt" className="text-xs text-muted-foreground">
            Custom Prompt (optional, appended to title + keywords generation):
          </Label>
          <Textarea
            id="custom-prompt"
            value={customPrompt}
            onChange={(e) => onCustomPromptChange(e.target.value)}
            placeholder="e.g. Focus on wellness niche, include seasonal keywords, target B2B audience..."
            disabled={isEnhancing}
            rows={2}
            maxLength={3500}
            className="resize-y"
          />
        </div>
      </div>
    </div>
  );
}
