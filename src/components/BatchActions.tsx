import { Button } from '@/components/ui/button';
import { Sparkles, Download, Loader2 } from 'lucide-react';
import { FilterType } from '@/types/photo';
import { FilterSelector } from './FilterSelector';

interface BatchActionsProps {
  photoCount: number;
  readyCount: number;
  selectedFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  onEnhanceAll: () => void;
  onDownloadAll: () => void;
  isEnhancing: boolean;
}

export function BatchActions({
  photoCount,
  readyCount,
  selectedFilter,
  onFilterChange,
  onEnhanceAll,
  onDownloadAll,
  isEnhancing,
}: BatchActionsProps) {
  if (photoCount === 0) return null;

  return (
    <div className="gradient-card rounded-2xl border border-border p-4 mb-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <h3 className="font-semibold text-foreground">Batch Processing</h3>
          <FilterSelector 
            selected={selectedFilter} 
            onSelect={onFilterChange}
            disabled={isEnhancing}
          />
        </div>
        
        <div className="flex gap-2">
          <Button
            onClick={onEnhanceAll}
            disabled={isEnhancing || photoCount === 0}
            variant="glow"
          >
            {isEnhancing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Enhancing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Enhance All ({photoCount})
              </>
            )}
          </Button>
          
          <Button
            onClick={onDownloadAll}
            variant="outline"
            disabled={readyCount === 0}
          >
            <Download className="w-4 h-4" />
            Download All ({readyCount})
          </Button>
        </div>
      </div>
    </div>
  );
}
