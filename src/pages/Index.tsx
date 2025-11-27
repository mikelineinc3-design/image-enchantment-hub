import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { PhotoUploader } from '@/components/PhotoUploader';
import { PhotoCard } from '@/components/PhotoCard';
import { StepsIndicator } from '@/components/StepsIndicator';
import { BatchActions } from '@/components/BatchActions';
import { PhotoFile, FilterType } from '@/types/photo';
import { extractExif, generateAiExif, fileToDataUrl } from '@/lib/exif';
import { enhanceImageWithAI, enhanceImageLocally } from '@/lib/imageEnhancer';
import { toast } from 'sonner';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

const Index = () => {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [enhancingIds, setEnhancingIds] = useState<Set<string>>(new Set());
  const [batchFilter, setBatchFilter] = useState<FilterType>('default');

  const currentStep = photos.length === 0 ? 1 : 
    photos.some(p => p.status === 'ready') ? 4 :
    photos.some(p => p.status === 'enhancing') ? 3 : 2;

  const handleUpload = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      toast.error('Please upload image files only');
      return;
    }

    for (const file of imageFiles) {
      const id = generateId();
      const preview = URL.createObjectURL(file);
      
      const newPhoto: PhotoFile = {
        id,
        file,
        preview,
        originalDataUrl: '',
        originalExif: {},
        rawExif: {},
        enhancedExif: {},
        status: 'extracting',
        selectedFilter: batchFilter,
      };

      setPhotos(prev => [...prev, newPhoto]);
      toast.success(`${file.name} uploaded`);

      try {
        const [exifResult, dataUrl] = await Promise.all([
          extractExif(file),
          fileToDataUrl(file)
        ]);
        
        const enhanced = generateAiExif(exifResult.display);
        
        setPhotos(prev => prev.map(p => 
          p.id === id 
            ? { 
                ...p, 
                originalExif: exifResult.display, 
                rawExif: exifResult.raw,
                enhancedExif: enhanced, 
                originalDataUrl: dataUrl,
                status: 'uploaded' 
              }
            : p
        ));
        toast.success(`EXIF extracted from ${file.name}`);
      } catch (error) {
        setPhotos(prev => prev.map(p => 
          p.id === id 
            ? { ...p, status: 'error', error: 'Failed to extract EXIF' }
            : p
        ));
        toast.error(`Failed to extract EXIF from ${file.name}`);
      }
    }
  }, [batchFilter]);

  const handleEnhance = useCallback(async (id: string) => {
    const photo = photos.find(p => p.id === id);
    if (!photo || photo.status === 'enhancing') return;

    setEnhancingIds(prev => new Set(prev).add(id));
    setPhotos(prev => prev.map(p => 
      p.id === id ? { ...p, status: 'enhancing' } : p
    ));

    toast.info(`Enhancing with ${photo.selectedFilter} filter...`);

    try {
      let enhancedDataUrl: string;
      
      try {
        enhancedDataUrl = await enhanceImageWithAI(
          photo.originalDataUrl || photo.preview,
          photo.selectedFilter,
          photo.rawExif
        );
      } catch (aiError) {
        console.warn('AI enhancement failed, using local fallback:', aiError);
        toast.info('Using local enhancement...');
        enhancedDataUrl = await enhanceImageLocally(
          photo.originalDataUrl || photo.preview,
          photo.selectedFilter,
          photo.rawExif
        );
      }
      
      setPhotos(prev => prev.map(p => 
        p.id === id 
          ? { ...p, enhancedPreview: enhancedDataUrl, status: 'ready' }
          : p
      ));
      
      toast.success('Image enhanced with full EXIF data!');
    } catch (error) {
      console.error('Enhancement error:', error);
      setPhotos(prev => prev.map(p => 
        p.id === id ? { ...p, status: 'error', error: 'Enhancement failed' } : p
      ));
      toast.error('Failed to enhance image');
    } finally {
      setEnhancingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [photos]);

  const handleEnhanceAll = useCallback(async () => {
    const toEnhance = photos.filter(p => p.status === 'uploaded' || p.status === 'ready' || p.status === 'error');
    
    if (toEnhance.length === 0) {
      toast.info('No photos to enhance');
      return;
    }

    toast.info(`Starting batch enhancement of ${toEnhance.length} photos...`);
    
    for (const photo of toEnhance) {
      await handleEnhance(photo.id);
    }
    
    toast.success('Batch enhancement complete!');
  }, [photos, handleEnhance]);

  const handleDownloadAll = useCallback(() => {
    const readyPhotos = photos.filter(p => p.status === 'ready' && p.enhancedPreview);
    
    if (readyPhotos.length === 0) {
      toast.info('No enhanced photos to download');
      return;
    }

    readyPhotos.forEach(photo => {
      const byteString = atob(photo.enhancedPreview!.split(',')[1]);
      const mimeString = photo.enhancedPreview!.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeString });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const baseName = photo.file.name.replace(/\.[^/.]+$/, '');
      link.download = `${baseName}_enhanced.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    });
    
    toast.success(`Downloaded ${readyPhotos.length} enhanced photos!`);
  }, [photos]);

  const handleRemove = useCallback((id: string) => {
    setPhotos(prev => {
      const photo = prev.find(p => p.id === id);
      if (photo) {
        URL.revokeObjectURL(photo.preview);
      }
      return prev.filter(p => p.id !== id);
    });
    toast.info('Photo removed');
  }, []);

  const handleFilterChange = useCallback((id: string, filter: FilterType) => {
    setPhotos(prev => prev.map(p => 
      p.id === id ? { ...p, selectedFilter: filter } : p
    ));
  }, []);

  const handleBatchFilterChange = useCallback((filter: FilterType) => {
    setBatchFilter(filter);
    setPhotos(prev => prev.map(p => ({ ...p, selectedFilter: filter })));
  }, []);

  const readyCount = photos.filter(p => p.status === 'ready').length;
  const isEnhancing = enhancingIds.size > 0;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        <StepsIndicator currentStep={currentStep} />

        <div className="max-w-2xl mx-auto mb-8">
          <PhotoUploader 
            onUpload={handleUpload}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
          />
        </div>

        <BatchActions
          photoCount={photos.length}
          readyCount={readyCount}
          selectedFilter={batchFilter}
          onFilterChange={handleBatchFilterChange}
          onEnhanceAll={handleEnhanceAll}
          onDownloadAll={handleDownloadAll}
          isEnhancing={isEnhancing}
        />

        {photos.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {photos.map(photo => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                onEnhance={handleEnhance}
                onRemove={handleRemove}
                onFilterChange={handleFilterChange}
                isEnhancing={enhancingIds.has(photo.id)}
              />
            ))}
          </div>
        )}

        {photos.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              Upload photos to get started with EXIF extraction and AI enhancement
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
