import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from './button';

interface BackButtonProps {
  fallbackPath?: string;
  className?: string;
  onClick?: () => void;
}

export function BackButton({ fallbackPath = '/', className, onClick }: BackButtonProps) {
  const navigate = useNavigate();
  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  };
  return (
    <Button variant="ghost" onClick={handleClick} className={className}>
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}

export default BackButton;
