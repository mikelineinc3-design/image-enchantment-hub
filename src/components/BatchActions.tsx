import { FilterType, FileType } from '@/types/photo';
import { FilterSelector } from './FilterSelector';
import { FileTypeSelector } from './FileTypeSelector';
import { Button } from '@/components/ui/button';
import { Sparkles, Download, Loader2 } from 'lucide-react';

interface BatchActionsProps {
  photoCount: number;
  readyCount: number;
  selectedFilter: FilterType;
  selectedFileType: FileType;
  onFilterChange: (filter: FilterType) => void;
  onFileTypeChange: (fileType: FileType) => void;
  onEnhanceAll: () => void;
  onDownloadAll: () => void;
  isEnhancing: boolean;
}

export function BatchActions({
  photoCount,
  readyCount,
  selectedFilter,
  selectedFileType,
  onFilterChange,
  onFileTypeChange,
  onEnhanceAll,
  onDownloadAll,
  isEnhancing
}: BatchActionsProps) {
  if (photoCount === 0) return null;

  return (
    <div className="mb-6 p-4 rounded-xl gradient-card border border-border">
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
            <span className="text-xs text-muted-foreground">Batch Filter:</span>
            <FilterSelector
              selected={selectedFilter}
              onSelect={onFilterChange}
              disabled={isEnhancing}
            />
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {readyCount}/{photoCount} ready
          </span>
          
          <Button
            onClick={onEnhanceAll}
            disabled={isEnhancing}
            variant="glow"
            size="sm"
          >
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
          
          <Button
            onClick={onDownloadAll}
            disabled={readyCount === 0}
            variant="outline"
            size="sm"
          >
            <Download className="w-4 h-4" />
            Download All
          </Button>
        </div>
      </div>
    </div>
  );
}
