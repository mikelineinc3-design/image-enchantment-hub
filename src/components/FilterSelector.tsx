import { FilterType } from '@/types/photo';
import { cn } from '@/lib/utils';
import { Sparkles, Film, Leaf, Wand2 } from 'lucide-react';

interface FilterSelectorProps {
  selected: FilterType;
  onSelect: (filter: FilterType) => void;
  disabled?: boolean;
}

const filters: { id: FilterType; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'default', label: 'Auto', icon: Wand2, description: 'AI-powered auto enhancement' },
  { id: 'vibrant', label: 'Vibrant', icon: Sparkles, description: 'Rich, saturated colors' },
  { id: 'cinematic', label: 'Cinematic', icon: Film, description: 'Movie-like color grade' },
  { id: 'natural', label: 'Natural', icon: Leaf, description: 'Subtle, realistic look' },
];

export function FilterSelector({ selected, onSelect, disabled }: FilterSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((filter) => {
        const Icon = filter.icon;
        return (
          <button
            key={filter.id}
            onClick={() => onSelect(filter.id)}
            disabled={disabled}
            title={filter.description}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              "border disabled:opacity-50 disabled:cursor-not-allowed",
              selected === filter.id
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
