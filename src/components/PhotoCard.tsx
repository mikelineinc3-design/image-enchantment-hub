import { useState } from 'react';
import { PhotoFile } from '@/types/photo';
import { ExifPanel } from './ExifPanel';
import { Button } from '@/components/ui/button';
import { Download, Sparkles, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PhotoCardProps {
  photo: PhotoFile;
  onEnhance: (id: string) => void;
  onRemove: (id: string) => void;
  isEnhancing: boolean;
}

export function PhotoCard({ photo, onEnhance, onRemove, isEnhancing }: PhotoCardProps) {
  const [showEnhanced, setShowEnhanced] = useState(false);
  
  const displayImage = showEnhanced && photo.enhancedPreview ? photo.enhancedPreview : photo.preview;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = displayImage;
    link.download = `enhanced_${photo.file.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const statusIcon = {
    uploaded: null,
    extracting: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
    enhancing: <Loader2 className="w-4 h-4 animate-spin text-primary" />,
    ready: <CheckCircle className="w-4 h-4 text-primary" />,
    error: <AlertCircle className="w-4 h-4 text-destructive" />,
  };

  return (
    <div className="gradient-card rounded-2xl border border-border overflow-hidden shadow-card transition-all duration-300 hover:shadow-glow hover:border-primary/30">
      {/* Image Preview */}
      <div className="relative aspect-video bg-background/50">
        <img
          src={displayImage}
          alt={photo.file.name}
          className="w-full h-full object-contain"
        />
        
        {/* Status Badge */}
        <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border">
          {statusIcon[photo.status]}
          <span className="text-xs font-medium capitalize">{photo.status}</span>
        </div>

        {/* Remove Button */}
        <button
          onClick={() => onRemove(photo.id)}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border hover:bg-destructive/20 hover:border-destructive/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Toggle Original/Enhanced */}
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

      {/* Content */}
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground truncate flex-1 mr-2">{photo.file.name}</h3>
          <span className="text-xs text-muted-foreground">
            {(photo.file.size / 1024 / 1024).toFixed(2)} MB
          </span>
        </div>

        {/* EXIF Data */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ExifPanel exif={photo.originalExif} title="Original EXIF" variant="original" />
          <ExifPanel exif={photo.enhancedExif} title="Enhanced EXIF" variant="enhanced" />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={() => onEnhance(photo.id)}
            disabled={isEnhancing || photo.status === 'enhancing'}
            variant="glow"
            className="flex-1"
          >
            {isEnhancing || photo.status === 'enhancing' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Enhancing...
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
