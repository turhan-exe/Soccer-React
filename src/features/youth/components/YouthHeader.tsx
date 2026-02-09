import { BackButton } from '@/components/ui/back-button';
import { Globe } from 'lucide-react';

export function YouthHeader() {
    return (
        <div className="flex items-center gap-2 mb-6 px-1">
            <BackButton className="h-8 w-8 bg-transparent hover:bg-white/10 border-none text-slate-400" />
            <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
                <Globe className="h-4 w-4" />
                <span className="tracking-wide">Altyapı Yönetimi</span>
                <span className="text-slate-600">{'>'}</span>
            </div>
        </div>
    );
}
