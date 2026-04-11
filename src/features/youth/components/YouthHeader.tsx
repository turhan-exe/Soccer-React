import { Globe } from 'lucide-react';

import { BackButton } from '@/components/ui/back-button';
import { useTranslation } from '@/contexts/LanguageContext';

export function YouthHeader() {
  const { t } = useTranslation();

  return (
    <div className="mb-6 flex items-center gap-2 px-1">
      <BackButton className="h-8 w-8 border-none bg-transparent text-slate-400 hover:bg-white/10" />
      <div className="flex items-center gap-2 text-sm font-medium text-slate-400">
        <Globe className="h-4 w-4" />
        <span className="tracking-wide">{t('youth.breadcrumb')}</span>
        <span className="text-slate-600">{'>'}</span>
      </div>
    </div>
  );
}
