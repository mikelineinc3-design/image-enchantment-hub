import { ExifData } from '@/types/photo';
import { exifLabels, formatExifValue } from '@/lib/exif';
import { Camera, MapPin, Settings, Calendar } from 'lucide-react';

interface ExifPanelProps {
  exif: ExifData;
  title: string;
  variant?: 'original' | 'enhanced';
}

const iconMap: Record<string, React.ReactNode> = {
  make: <Camera className="w-4 h-4" />,
  model: <Camera className="w-4 h-4" />,
  dateTime: <Calendar className="w-4 h-4" />,
  gpsLatitude: <MapPin className="w-4 h-4" />,
  gpsLongitude: <MapPin className="w-4 h-4" />,
};

export function ExifPanel({ exif, title, variant = 'original' }: ExifPanelProps) {
  const entries = Object.entries(exif).filter(([_, value]) => value !== undefined);

  return (
    <div className={`rounded-xl p-4 ${variant === 'enhanced' ? 'bg-primary/10 border border-primary/30' : 'bg-secondary/50 border border-border'}`}>
      <h3 className={`text-sm font-semibold mb-3 ${variant === 'enhanced' ? 'text-primary' : 'text-muted-foreground'}`}>
        {title}
      </h3>
      
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No EXIF data found</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground mt-0.5">
                {iconMap[key] || <Settings className="w-4 h-4" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-muted-foreground text-xs">{exifLabels[key] || key}</p>
                <p className="text-foreground truncate">{formatExifValue(key, value)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
