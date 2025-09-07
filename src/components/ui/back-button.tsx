import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from './button';

interface BackButtonProps {
  fallbackPath?: string;
}

export function BackButton({ fallbackPath = '/' }: BackButtonProps) {
  const navigate = useNavigate();
  const handleClick = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  };
  return (
    <Button variant="ghost" onClick={handleClick}>
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}

export default BackButton;
