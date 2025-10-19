import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import { Instagram, MessageCircle, Send, Youtube } from 'lucide-react';

type ContactChannel = {
  id: 'instagram' | 'whatsapp' | 'telegram' | 'youtube';
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  accent: string;
};

const CONTACT_CHANNELS: ContactChannel[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    description: 'Kulubumuzun son duyurulari, mac ozetleri ve etkinliklerini buradan takip edebilirsin.',
    href: 'https://instagram.com/FHSfootball',
    icon: Instagram,
    accent: 'from-pink-500/20 to-rose-500/10',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Dogrudan iletisim icin WhatsApp hattimizi kullanabilirsin. Mesajlara haftanin her gunu yanit veriyoruz.',
    href: 'https://wa.me/905550000000',
    icon: MessageCircle,
    accent: 'from-emerald-500/25 to-emerald-400/10',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    description: 'Toplulugumuza katil ve transfer haberlerini ilk sen ogrenen ol.',
    href: 'https://t.me/FHSfootball',
    icon: Send,
    accent: 'from-sky-500/25 to-cyan-500/10',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    description: 'Haftalik ozetler, egitimler ve menajerlik ipuclari icin YouTube kanalimiz aktif.',
    href: 'https://youtube.com/@FHSfootball',
    icon: Youtube,
    accent: 'from-red-500/25 to-red-400/10',
  },
];

const ContactPage: React.FC = () => {
  const openLink = (href: string) => {
    if (typeof window === 'undefined') {
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-0 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute right-[-10%] bottom-[-15%] h-[22rem] w-[22rem] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-6 backdrop-blur-lg">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BackButton />
              <div>
                <h1 className="text-3xl font-semibold">Iletisim</h1>
                <p className="mt-1 text-sm text-slate-300">
                  Oyuncularimiz ve menajerlerimiz icin resmi iletisim kanallarimiz. Ornek baglantilar yakinda guncellenecek.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {CONTACT_CHANNELS.map((channel) => {
            const Icon = channel.icon;
            return (
              <Card
                key={channel.id}
                className={`border-white/10 bg-slate-900/60 backdrop-blur-lg transition hover:border-emerald-300/30 hover:shadow-xl hover:shadow-emerald-500/10`}
              >
                <CardHeader>
                  <div
                    className={`inline-flex items-center gap-2 rounded-full bg-gradient-to-r ${channel.accent} px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-100`}
                  >
                    <Icon className="h-4 w-4" />
                    {channel.label}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CardTitle className="text-lg text-slate-100">{channel.label} Kanalimiz</CardTitle>
                  <p className="text-sm text-slate-300">{channel.description}</p>
                  <Button
                    type="button"
                    className="w-full bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                    onClick={() => openLink(channel.href)}
                  >
                    {channel.label} sayfasina git
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="border-white/10 bg-slate-900/60 backdrop-blur-lg">
          <CardContent className="flex flex-col gap-3 p-4 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="font-semibold text-slate-100">Destek ekibi ile iletisime gec</p>
              <p>Bekledigimiz sayfalar hazir olana kadar bu ornek hesaplari kullanabilirsin.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-emerald-400/50 text-emerald-100 hover:bg-emerald-500/10"
              onClick={() => openLink('mailto:support@FHSfootball.test')}
            >
              support@FHSfootball.test
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ContactPage;
