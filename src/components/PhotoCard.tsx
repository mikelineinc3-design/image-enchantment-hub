import { useState } from 'react';
import { PhotoFile, FilterType, FileType } from '@/types/photo';
import { FilterSelector } from './FilterSelector';
import { FileTypeSelector } from './FileTypeSelector';
import { MetadataPanel } from './MetadataPanel';
import { Button } from '@/components/ui/button';
import { Download, Sparkles, Loader2, CheckCircle, AlertCircle, X, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PhotoCardProps {
  photo: PhotoFile;
  onEnhance: (id: string) => void;
  onRemove: (id: string) => void;
  onFilterChange: (id: string, filter: FilterType) => void;
  onFileTypeChange: (id: string, fileType: FileType) => void;
  isEnhancing: boolean;
}

export function PhotoCard({ photo, onEnhance, onRemove, onFilterChange, onFileTypeChange, isEnhancing }: PhotoCardProps) {
  const [showEnhanced, setShowEnhanced] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  
  const displayImage = showEnhanced && photo.enhancedPreview ? photo.enhancedPreview : photo.preview;

  const handleDownload = () => {
    if (!photo.enhancedPreview) {
      toast.error('Please enhance the photo first');
      return;
    }
    
    const byteString = atob(photo.enhancedPreview.split(',')[1]);
    const mimeString = photo.enhancedPreview.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const filename = photo.metadata?.filename || `${photo.file.name.replace(/\.[^/.]+$/, '')}_enhanced.jpg`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    
    toast.success('Photo downloaded with embedded EXIF data!');
  };

  const statusIcon = {
    uploaded: null,
    extracting: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
    enhancing: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
    'generating-metadata': <Loader2 className="w-4 h-4 animate-spin text-primary" />,
    ready: <CheckCircle className="w-4 h-4 text-primary" />,
    error: <AlertCircle className="w-4 h-4 text-destructive" />,
  };

  const statusLabel = {
    uploaded: 'uploaded',
    extracting: 'extracting',
    enhancing: 'enhancing',
    'generating-metadata': 'generating metadata',
    ready: 'ready',
    error: 'error',
  };

  return (
    <div className="gradient-card rounded-2xl border border-border overflow-hidden shadow-card transition-all duration-300 hover:shadow-glow hover:border-primary/30">
      <div className="relative aspect-video bg-background/50">
        <img
          src={displayImage}
          alt={photo.file.name}
          className="w-full h-full object-contain"
        />
        
        <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border">
          {statusIcon[photo.status]}
          <span className="text-xs font-medium capitalize">{statusLabel[photo.status]}</span>
        </div>

        <button
          onClick={() => onRemove(photo.id)}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border hover:bg-destructive/20 hover:border-destructive/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {photo.enhancedPreview && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex rounded-full bg-background/80 backdrop-blur-sm border border-border p-1">
            <button
              onClick={() => setShowEnhanced(false)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                !showEnhanced ? "gradient-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Original
            </button>
            <button
              onClick={() => setShowEnhanced(true)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                showEnhanced ? "gradient-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Enhanced
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground truncate flex-1 mr-2">{photo.file.name}</h3>
          <span className="text-xs text-muted-foreground">
            {(photo.file.size / 1024 / 1024).toFixed(2)} MB
          </span>
        </div>

        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">File Type (for metadata):</span>
          <FileTypeSelector
            selected={photo.fileType}
            onSelect={(type) => onFileTypeChange(photo.id, type)}
            disabled={isEnhancing}
          />
        </div>

        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Enhancement Filter:</span>
          <FilterSelector
            selected={photo.selectedFilter}
            onSelect={(filter) => onFilterChange(photo.id, filter)}
            disabled={isEnhancing}
          />
        </div>


        {photo.metadata && (
          <div className="space-y-2">
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <FileText className="w-4 h-4" />
              {showMetadata ? 'Hide' : 'Show'} Microstock Metadata
            </button>
            {showMetadata && <MetadataPanel metadata={photo.metadata} />}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => onEnhance(photo.id)}
            disabled={isEnhancing || photo.status === 'enhancing' || photo.status === 'generating-metadata'}
            variant="glow"
            className="flex-1"
          >
            {isEnhancing || photo.status === 'enhancing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Enhancing...
              </>
            ) : photo.status === 'generating-metadata' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating Metadata...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Enhance Photo
              </>
            )}
          </Button>
          
          <Button
            onClick={handleDownload}
            variant="outline"
            size="icon"
            disabled={photo.status !== 'ready'}
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
