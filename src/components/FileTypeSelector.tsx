import { FileType } from '@/types/photo';
import { cn } from '@/lib/utils';

interface FileTypeSelectorProps {
  selected: FileType;
  onSelect: (type: FileType) => void;
  disabled?: boolean;
}

const fileTypes: { value: FileType; label: string }[] = [
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'eps', label: 'EPS' },
  { value: 'svg', label: 'SVG' },
];

export function FileTypeSelector({ selected, onSelect, disabled }: FileTypeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {fileTypes.map((type) => (
        <button
          key={type.value}
          onClick={() => onSelect(type.value)}
          disabled={disabled}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
            selected === type.value
              ? "gradient-primary text-primary-foreground border-primary"
              : "bg-background/50 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
          )}
        >
          {type.label}
        </button>
      ))}
    </div>
  );
}
