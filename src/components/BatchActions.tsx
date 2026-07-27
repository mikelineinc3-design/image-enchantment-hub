import { FilterType, FileType, MetadataMode, UpscaleTarget } from '@/types/photo';
import { FilterSelector } from './FilterSelector';
import { FileTypeSelector } from './FileTypeSelector';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Download, Loader2, Database, FileText, FileSpreadsheet, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BatchActionsProps {
  photoCount: number;
  readyCount: number;
  selectedFilters: FilterType[];
  selectedFileType: FileType;
  upscaleTarget: UpscaleTarget;
  metadataMode: MetadataMode;
  customPrompt: string;
  fpMode: boolean;
  generateMetadataEnabled: boolean;
  onFilterChange: (filters: FilterType[]) => void;
  onFileTypeChange: (fileType: FileType) => void;
  onUpscaleTargetChange: (target: UpscaleTarget) => void;
  onMetadataModeChange: (mode: MetadataMode) => void;
  onCustomPromptChange: (prompt: string) => void;
  onFpModeChange: (enabled: boolean) => void;
  onGenerateMetadataChange: (enabled: boolean) => void;
  onEnhanceAll: () => void;
  onDownloadAll: () => void;
  onDownloadCSV: () => void;
  isEnhancing: boolean;
}

export function BatchActions({
  photoCount,
  readyCount,
  selectedFilters,
  selectedFileType,
  upscaleTarget,
  metadataMode,
  customPrompt,
  fpMode,
  generateMetadataEnabled,
  onFilterChange,
  onFileTypeChange,
  onUpscaleTargetChange,
  onMetadataModeChange,
  onCustomPromptChange,
  onFpModeChange,
  onGenerateMetadataChange,
  onEnhanceAll,
  onDownloadAll,
  onDownloadCSV,
  isEnhancing,
}: BatchActionsProps) {
  if (photoCount === 0) return null;

  const upscaleOptions: { value: UpscaleTarget; label: string }[] = [
    { value: '4mp', label: '4MP' },
    { value: '5mp', label: '5MP' },
    { value: '6mp', label: '6MP' },
  ];

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
            <span className="text-xs text-muted-foreground">Upscale Target (click to toggle):</span>
            <div className="flex items-center gap-2 h-9">
              {upscaleOptions.map(opt => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={upscaleTarget === opt.value ? 'default' : 'outline'}
                  disabled={isEnhancing}
                  onClick={() =>
                    onUpscaleTargetChange(upscaleTarget === opt.value ? 'none' : opt.value)
                  }
                  className={cn(
                    upscaleTarget === opt.value && 'gradient-primary text-primary-foreground'
                  )}
                >
                  {opt.label}
                </Button>
              ))}
              <Label className="text-xs text-muted-foreground ml-1">
                {upscaleTarget === 'none' ? 'No upscale' : `→ ${upscaleTarget.toUpperCase()}`}
              </Label>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">FP Mode (force JPG ≥ 2MB):</span>
            <div className="flex items-center gap-2 h-9">
              <Button
                type="button"
                size="sm"
                variant={fpMode ? 'default' : 'outline'}
                disabled={isEnhancing}
                onClick={() => onFpModeChange(!fpMode)}
                className={cn(fpMode && 'gradient-primary text-primary-foreground')}
              >
                <Maximize2 className="w-4 h-4" />
                FP
              </Button>
              <Label className="text-xs text-muted-foreground ml-1">
                {fpMode ? 'JPG ≥ 2MB' : 'Off'}
              </Label>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Generate Metadata:</span>
            <div className="flex items-center gap-2 h-9">
              <Button
                type="button"
                size="sm"
                variant={generateMetadataEnabled ? 'default' : 'outline'}
                disabled={isEnhancing}
                onClick={() => onGenerateMetadataChange(!generateMetadataEnabled)}
                className={cn(generateMetadataEnabled && 'gradient-primary text-primary-foreground')}
              >
                <FileText className="w-4 h-4" />
                {generateMetadataEnabled ? 'On' : 'Off'}
              </Button>
              <Label className="text-xs text-muted-foreground ml-1">
                {generateMetadataEnabled ? 'Title + keywords' : 'Upscale/enhance only'}
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

          <Button onClick={onDownloadCSV} disabled={readyCount === 0} variant="outline" size="sm">
            <FileSpreadsheet className="w-4 h-4" />
            Download CSV
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
