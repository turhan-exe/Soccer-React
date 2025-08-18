import { Progress } from "@/components/ui/progress";

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
    <div className={`space-y-1 ${className}`}>
      <div className="flex justify-between items-center text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="text-foreground font-semibold">{value.toFixed(3)}</span>
      </div>
      <Progress value={percentage} className="h-2" />
    </div>
  );
};