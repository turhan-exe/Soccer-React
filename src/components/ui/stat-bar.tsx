import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StatBarProps {
  label: string;
  value: number;
  max?: number;
  className?: string;
}

export const StatBar: React.FC<StatBarProps> = ({ 
  label, 
  value, 
  max = 1, 
  className = "" 
}) => {
  const percentage = Math.min((value / max) * 100, 100);
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`space-y-1 ${className}`}>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground font-medium">{label}</span>
            <span className="text-foreground font-semibold">
              {percentage.toFixed(0)}
            </span>
          </div>
          <Progress value={percentage} className="h-2" />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Maks: {Math.round(max * 100)}
      </TooltipContent>
    </Tooltip>
  );
};