import { useCallback } from 'react';
import { Upload, ImagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PhotoUploaderProps {
  onUpload: (files: FileList) => void;
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
}

export function PhotoUploader({ onUpload, isDragging, setIsDragging }: PhotoUploaderProps) {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, [setIsDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, [setIsDragging]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      onUpload(e.dataTransfer.files);
    }
  }, [onUpload, setIsDragging]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      onUpload(e.target.files);
    }
  }, [onUpload]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative border-2 border-dashed rounded-2xl p-12 transition-all duration-300 cursor-pointer group",
        isDragging 
          ? "border-primary bg-primary/10 scale-[1.02]" 
          : "border-border hover:border-primary/50 hover:bg-secondary/50"
      )}
    >
      <input
        type="file"
        accept="image/*,.eps,application/postscript"
        multiple
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      
      <div className="flex flex-col items-center gap-4 text-center">
        <div className={cn(
          "p-4 rounded-2xl transition-all duration-300",
          isDragging ? "gradient-primary shadow-glow" : "bg-secondary group-hover:bg-primary/20"
        )}>
          {isDragging ? (
            <ImagePlus className="w-10 h-10 text-primary-foreground" />
          ) : (
            <Upload className="w-10 h-10 text-muted-foreground group-hover:text-primary" />
          )}
        </div>
        
        <div>
          <p className="text-lg font-semibold text-foreground">
            {isDragging ? 'Drop your photos here' : 'Drag & drop photos'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            or click to browse • Supports JPG, PNG, WEBP
          </p>
        </div>
      </div>
    </div>
  );
}
