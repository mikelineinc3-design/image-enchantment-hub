import { FilterType } from '@/types/photo';
import { cn } from '@/lib/utils';
import { Sparkles, Film, Leaf, Wand2, Box, Focus, Sun } from 'lucide-react';

interface FilterSelectorProps {
  selected: FilterType[];
  onSelect: (filters: FilterType[]) => void;
  disabled?: boolean;
}

const filters: { id: FilterType; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'default', label: 'Auto', icon: Wand2, description: 'AI-powered auto enhancement' },
  { id: 'vibrant', label: 'Vibrant', icon: Sparkles, description: 'Rich, saturated colors' },
  { id: 'cinematic', label: 'Cinematic', icon: Film, description: 'Movie-like color grade' },
  { id: 'natural', label: 'Natural', icon: Leaf, description: 'Subtle, realistic look' },
  { id: 'product', label: 'Product', icon: Box, description: 'Studio-style clarity & lighting' },
  { id: 'sharpener', label: 'Sharpener', icon: Focus, description: 'Enhanced details & sharpness' },
  { id: 'hdr', label: 'HDR', icon: Sun, description: 'Dynamic range & shadow recovery' },
];

export function FilterSelector({ selected, onSelect, disabled }: FilterSelectorProps) {
  const handleToggle = (filterId: FilterType) => {
    if (selected.includes(filterId)) {
      // Remove filter (but keep at least one)
      if (selected.length > 1) {
        onSelect(selected.filter(f => f !== filterId));
      }
    } else {
      // Add filter
      onSelect([...selected, filterId]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => {
        const Icon = filter.icon;
        const isSelected = selected.includes(filter.id);
        return (
          <button
            key={filter.id}
            onClick={() => handleToggle(filter.id)}
            disabled={disabled}
            title={filter.description}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              "border disabled:opacity-50 disabled:cursor-not-allowed",
              isSelected
                ? "gradient-primary text-primary-foreground border-primary"
                : "bg-background/50 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
            )}
          >
            <Icon className="w-3 h-3" />
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
