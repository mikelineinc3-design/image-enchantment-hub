import { supabase } from '@/integrations/supabase/client';
import { fileToDataUrl } from '@/lib/exif';

/**
 * Convert an EPS file to a PNG data URL via the CloudConvert edge function.
 * Returns null on any failure — callers can gracefully fall through.
 */
export async function convertEpsToPngViaCloudConvert(
  file: File,
  cloudConvertKeys: string[]
): Promise<string | null> {
  if (!cloudConvertKeys || cloudConvertKeys.length === 0) return null;

  try {
    const dataUrl = await fileToDataUrl(file);
    // Strip the "data:...;base64," prefix — edge function expects raw base64.
    const commaIdx = dataUrl.indexOf(',');
    const epsBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

    const { data, error } = await supabase.functions.invoke('convert-eps-preview', {
      body: { epsBase64, cloudConvertApiKeys: cloudConvertKeys },
    });

    if (error) {
      console.warn('[CloudConvert] edge function error', error);
      return null;
    }
    if (!data || typeof data.previewDataUrl !== 'string') {
      console.warn('[CloudConvert] no previewDataUrl in response', data);
      return null;
    }
    return data.previewDataUrl;
  } catch (err) {
    console.warn('[CloudConvert] client-side error', err);
    return null;
  }
}
