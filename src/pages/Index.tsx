import { useState, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { PhotoUploader } from '@/components/PhotoUploader';
import { PhotoCard } from '@/components/PhotoCard';
import { StepsIndicator } from '@/components/StepsIndicator';
import { BatchActions } from '@/components/BatchActions';
import { ApiKeyManager } from '@/components/ApiKeyManager';
import { PhotoFile, FilterType, FileType, ImageFormat, MetadataMode } from '@/types/photo';
import { extractExif, generateAiExif, fileToDataUrl } from '@/lib/exif';
import { enhanceImageWithAI, enhanceImageLocally, embedIptcXmpMetadata, detectImageFormat, validateImageDataUrl } from '@/lib/imageEnhancer';
import { generateMicrostockMetadata } from '@/lib/metadataGenerator';
import { downloadAllAsZip } from '@/lib/zipDownloader';
import { useApiKeys } from '@/hooks/useApiKeys';
import { toast } from 'sonner';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// Batch processing configuration
const BATCH_SIZE = 3; // Process 3 images at a time
const BATCH_DELAY = 500; // 500ms delay between batches

const Index = () => {
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [enhancingIds, setEnhancingIds] = useState<Set<string>>(new Set());
  const [batchFilters, setBatchFilters] = useState<FilterType[]>(['default']);
  const [batchFileType, setBatchFileType] = useState<FileType>('jpg');
  const [upscaleEnabled, setUpscaleEnabled] = useState<boolean>(true);
  const [metadataMode, setMetadataMode] = useState<MetadataMode>('default');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const processingRef = useRef<boolean>(false);
  
  const { getKeys, getAllKeys, addKey, removeKey } = useApiKeys();

  const currentStep = photos.length === 0 ? 1 : 
    photos.some(p => p.status === 'ready') ? 4 :
    photos.some(p => p.status === 'enhancing' || p.status === 'generating-metadata') ? 3 : 2;

  const handleUpload = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      toast.error('Please upload image files only');
      return;
    }

    // Process uploads in parallel batches
    const uploadBatches: File[][] = [];
    for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
      uploadBatches.push(imageFiles.slice(i, i + BATCH_SIZE));
    }

    for (const batch of uploadBatches) {
      await Promise.all(batch.map(async (file) => {
        const id = generateId();
        const preview = URL.createObjectURL(file);
        const imageFormat = detectImageFormat(file);
        
        const newPhoto: PhotoFile = {
          id,
          file,
          preview,
          originalDataUrl: '',
          originalExif: {},
          rawExif: {},
          enhancedExif: {},
          status: 'extracting',
          selectedFilters: batchFilters,
          fileType: batchFileType,
          imageFormat,
        };

        setPhotos(prev => [...prev, newPhoto]);

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
        } catch (error) {
          setPhotos(prev => prev.map(p => 
            p.id === id 
              ? { ...p, status: 'error', error: 'Failed to extract EXIF' }
              : p
          ));
        }
      }));
    }
    
    toast.success(`${imageFiles.length} photos uploaded`);
  }, [batchFilters, batchFileType]);

  const handleEnhance = useCallback(async (id: string): Promise<boolean> => {
    const photo = photos.find(p => p.id === id);
    if (!photo || photo.status === 'enhancing' || photo.status === 'generating-metadata') {
      return false;
    }

    setEnhancingIds(prev => new Set(prev).add(id));
    setPhotos(prev => prev.map(p => 
      p.id === id ? { ...p, status: 'enhancing', error: undefined } : p
    ));

    const hasFilters = photo.selectedFilters.length > 0;
    const isPng = photo.imageFormat === 'png';
    
    // Validate we have a proper data URL to work with
    const sourceDataUrl = photo.originalDataUrl || photo.preview;
    if (!sourceDataUrl || sourceDataUrl.length < 100) {
      console.error('No valid source image data URL for enhancement');
      setPhotos(prev => prev.map(p => 
        p.id === id ? { ...p, status: 'error', error: 'Invalid image data' } : p
      ));
      setEnhancingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return false;
    }
    
    console.log(`Starting enhancement for ${id}: format=${photo.imageFormat}, dataUrl length=${sourceDataUrl.length}`);

    try {
      // Get original dimensions from raw exif or from the image
      const originalWidth = photo.rawExif.width || photo.originalExif.width || 0;
      const originalHeight = photo.rawExif.height || photo.originalExif.height || 0;
      
      let enhancedDataUrl: string;
      
      if (hasFilters) {
        // Get all API keys for rotation
        const allKeys = getAllKeys();
        
        try {
          enhancedDataUrl = await enhanceImageWithAI(
            sourceDataUrl,
            photo.selectedFilters,
            photo.rawExif,
            originalWidth,
            originalHeight,
            photo.imageFormat,
            allKeys.gemini.length > 0 ? allKeys.gemini : undefined,
            upscaleEnabled
          );
        } catch (aiError) {
          console.warn('AI enhancement failed, using local fallback:', aiError);
          enhancedDataUrl = await enhanceImageLocally(
            sourceDataUrl,
            photo.selectedFilters,
            photo.rawExif,
            originalWidth,
            originalHeight,
            photo.imageFormat,
            upscaleEnabled
          );
        }
      } else {
        // No filters selected - just upscale (if on) and embed EXIF (skip AI enhancement)
        enhancedDataUrl = await enhanceImageLocally(
          sourceDataUrl,
          [],
          photo.rawExif,
          originalWidth,
          originalHeight,
          photo.imageFormat,
          upscaleEnabled
        );
      }
      
      // Update with enhanced image
      setPhotos(prev => prev.map(p => 
        p.id === id 
          ? { ...p, enhancedPreview: enhancedDataUrl, status: 'generating-metadata' }
          : p
      ));
      
      // Generate metadata with OpenAI keys if available (with retry)
      // Validate the data URL first to prevent sending invalid data to edge function
      if (!validateImageDataUrl(enhancedDataUrl)) {
        console.error('Enhanced image data URL is invalid, skipping metadata generation');
        setPhotos(prev => prev.map(p => 
          p.id === id 
            ? { ...p, status: 'ready' }
            : p
        ));
        return true;
      }
      
      const allKeys = getAllKeys();
      try {
        const metadata = await generateMicrostockMetadata(
          enhancedDataUrl,
          photo.fileType,
          allKeys.openai.length > 0 ? allKeys.openai : undefined,
          metadataMode,
          customPrompt
        );
        
        // Embed IPTC/XMP metadata into the enhanced image (only for JPEG)
        const finalEnhancedImage = embedIptcXmpMetadata(
          enhancedDataUrl,
          metadata.title,
          metadata.description,
          metadata.keywords,
          photo.imageFormat
        );
        
        setPhotos(prev => prev.map(p => 
          p.id === id 
            ? { ...p, enhancedPreview: finalEnhancedImage, metadata, status: 'ready' }
            : p
        ));
        
        return true;
      } catch (metadataError) {
        console.warn('Metadata generation failed:', metadataError);
        // Still mark as ready but without metadata
        setPhotos(prev => prev.map(p => 
          p.id === id 
            ? { ...p, status: 'ready' }
            : p
        ));
        return true; // Enhancement succeeded even if metadata failed
      }
    } catch (error) {
      console.error('Enhancement error:', error);
      setPhotos(prev => prev.map(p => 
        p.id === id ? { ...p, status: 'error', error: 'Enhancement failed' } : p
      ));
      return false;
    } finally {
      setEnhancingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [photos, getAllKeys, upscaleEnabled, metadataMode, customPrompt]);

  const handleEnhanceAll = useCallback(async () => {
    if (processingRef.current) {
      toast.info('Batch processing already in progress');
      return;
    }

    const toEnhance = photos.filter(p => p.status === 'uploaded' || p.status === 'error');
    
    if (toEnhance.length === 0) {
      toast.info('No photos to enhance');
      return;
    }

    processingRef.current = true;
    toast.info(`Starting batch enhancement of ${toEnhance.length} photos (${BATCH_SIZE} at a time)...`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Process in batches
    const batches: PhotoFile[][] = [];
    for (let i = 0; i < toEnhance.length; i += BATCH_SIZE) {
      batches.push(toEnhance.slice(i, i + BATCH_SIZE));
    }
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      toast.info(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} photos)...`);
      
      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(photo => handleEnhance(photo.id))
      );
      
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          successCount++;
        } else {
          failCount++;
        }
      });
      
      // Small delay between batches to prevent overwhelming the API
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }
    
    processingRef.current = false;
    
    if (failCount > 0) {
      toast.warning(`Batch complete: ${successCount} enhanced, ${failCount} failed`);
    } else {
      toast.success(`All ${successCount} photos enhanced successfully!`);
    }
  }, [photos, handleEnhance]);

  const handleDownloadAll = useCallback(async () => {
    const readyPhotos = photos.filter(p => p.status === 'ready' && p.enhancedPreview);
    
    if (readyPhotos.length === 0) {
      toast.info('No enhanced photos to download');
      return;
    }

    try {
      toast.info('Creating ZIP file with all enhanced photos...');
      await downloadAllAsZip(readyPhotos);
      toast.success(`Downloaded ${readyPhotos.length} enhanced photos as ZIP!`);
    } catch (error) {
      console.error('ZIP download error:', error);
      toast.error('Failed to create ZIP file');
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

  const handleFilterChange = useCallback((id: string, filters: FilterType[]) => {
    setPhotos(prev => prev.map(p => 
      p.id === id ? { ...p, selectedFilters: filters } : p
    ));
  }, []);

  const handleFileTypeChange = useCallback((id: string, fileType: FileType) => {
    setPhotos(prev => prev.map(p => 
      p.id === id ? { ...p, fileType } : p
    ));
  }, []);

  const handleBatchFilterChange = useCallback((filters: FilterType[]) => {
    setBatchFilters(filters);
    setPhotos(prev => prev.map(p => ({ ...p, selectedFilters: filters })));
  }, []);

  const handleBatchFileTypeChange = useCallback((fileType: FileType) => {
    setBatchFileType(fileType);
    setPhotos(prev => prev.map(p => ({ ...p, fileType })));
  }, []);

  const readyCount = photos.filter(p => p.status === 'ready').length;
  const isEnhancing = enhancingIds.size > 0 || processingRef.current;

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

        {/* API Key Manager */}
        <div className="max-w-2xl mx-auto mb-6">
          <ApiKeyManager 
            geminiKeys={getKeys('gemini')}
            openaiKeys={getKeys('openai')}
            onAddKey={addKey}
            onRemoveKey={removeKey}
          />
        </div>

        <BatchActions
          photoCount={photos.length}
          readyCount={readyCount}
          selectedFilters={batchFilters}
          selectedFileType={batchFileType}
          upscaleEnabled={upscaleEnabled}
          metadataMode={metadataMode}
          customPrompt={customPrompt}
          onFilterChange={handleBatchFilterChange}
          onFileTypeChange={handleBatchFileTypeChange}
          onUpscaleChange={setUpscaleEnabled}
          onMetadataModeChange={setMetadataMode}
          onCustomPromptChange={setCustomPrompt}
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
                onFileTypeChange={handleFileTypeChange}
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
