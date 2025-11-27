import { Upload, FileSearch, Sparkles, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const steps: Step[] = [
  { id: 1, title: 'Upload', description: 'Add your photos', icon: <Upload className="w-5 h-5" /> },
  { id: 2, title: 'Extract', description: 'Read EXIF data', icon: <FileSearch className="w-5 h-5" /> },
  { id: 3, title: 'Enhance', description: 'AI optimization', icon: <Sparkles className="w-5 h-5" /> },
  { id: 4, title: 'Download', description: 'Get results', icon: <Download className="w-5 h-5" /> },
];

interface StepsIndicatorProps {
  currentStep: number;
}

export function StepsIndicator({ currentStep }: StepsIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 md:gap-4 py-6">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300",
                currentStep >= step.id
                  ? "gradient-primary shadow-glow text-primary-foreground"
                  : "bg-secondary text-muted-foreground border border-border"
              )}
            >
              {step.icon}
            </div>
            <div className="mt-2 text-center hidden sm:block">
              <p className={cn(
                "text-sm font-semibold",
                currentStep >= step.id ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.title}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
          
          {index < steps.length - 1 && (
            <div className={cn(
              "w-8 md:w-16 h-0.5 mx-2 transition-colors duration-300",
              currentStep > step.id ? "bg-primary" : "bg-border"
            )} />
          )}
        </div>
      ))}
    </div>
  );
}
