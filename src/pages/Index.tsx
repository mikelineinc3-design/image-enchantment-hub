import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { PhotoUploader } from '@/components/PhotoUploader';
import { PhotoCard } from '@/components/PhotoCard';
import { StepsIndicator } from '@/components/StepsIndicator';
import { PhotoFile } from '@/types/photo';
import { extractExif, generateAiExif } from '@/lib/exif';
import { toast } from 'sonner';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

const Index = () => {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [enhancingId, setEnhancingId] = useState<string | null>(null);

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
        originalExif: {},
        enhancedExif: {},
        status: 'extracting',
      };

      setPhotos(prev => [...prev, newPhoto]);
      toast.success(`${file.name} uploaded`);

      // Extract EXIF
      try {
        const exif = await extractExif(file);
        const enhanced = generateAiExif(exif);
        
        setPhotos(prev => prev.map(p => 
          p.id === id 
            ? { ...p, originalExif: exif, enhancedExif: enhanced, status: 'uploaded' }
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
  }, []);

  const handleEnhance = useCallback(async (id: string) => {
    const photo = photos.find(p => p.id === id);
    if (!photo) return;

    setEnhancingId(id);
    setPhotos(prev => prev.map(p => 
      p.id === id ? { ...p, status: 'enhancing' } : p
    ));

    toast.info('Enhancing image... This may take a moment');

    // Simulate image enhancement with canvas operations
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          
          if (ctx) {
            // Draw original image
            ctx.drawImage(img, 0, 0);
            
            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Enhance colors - increase saturation and contrast
            for (let i = 0; i < data.length; i += 4) {
              // Increase contrast
              const factor = 1.15;
              data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));     // R
              data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128)); // G
              data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128)); // B
              
              // Slight saturation boost
              const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
              const satBoost = 1.2;
              data[i] = Math.min(255, Math.max(0, avg + satBoost * (data[i] - avg)));
              data[i + 1] = Math.min(255, Math.max(0, avg + satBoost * (data[i + 1] - avg)));
              data[i + 2] = Math.min(255, Math.max(0, avg + satBoost * (data[i + 2] - avg)));
            }
            
            ctx.putImageData(imageData, 0, 0);
          }
          resolve();
        };
        img.onerror = reject;
        img.src = photo.preview;
      });

      // Simulate processing time
      await new Promise(r => setTimeout(r, 1500));

      const enhancedPreview = canvas.toDataURL(photo.file.type);
      
      setPhotos(prev => prev.map(p => 
        p.id === id 
          ? { ...p, enhancedPreview, status: 'ready' }
          : p
      ));
      
      toast.success('Image enhanced successfully!');
    } catch (error) {
      console.error('Enhancement error:', error);
      setPhotos(prev => prev.map(p => 
        p.id === id ? { ...p, status: 'error', error: 'Enhancement failed' } : p
      ));
      toast.error('Failed to enhance image');
    } finally {
      setEnhancingId(null);
    }
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        {/* Steps Indicator */}
        <StepsIndicator currentStep={currentStep} />

        {/* Upload Area */}
        <div className="max-w-2xl mx-auto mb-8">
          <PhotoUploader 
            onUpload={handleUpload}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
          />
        </div>

        {/* Photos Grid */}
        {photos.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {photos.map(photo => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                onEnhance={handleEnhance}
                onRemove={handleRemove}
                isEnhancing={enhancingId === photo.id}
              />
            ))}
          </div>
        )}

        {/* Empty State */}
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
