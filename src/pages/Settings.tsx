import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/contexts/ThemeContext';
import { Settings, Moon, Sun, Volume2, Trash2, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BackButton } from '@/components/ui/back-button';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const handleClearCache = () => {
    toast.success('Önbellek temizlendi');
  };

  const handleExportData = () => {
    toast.success('Veriler dışa aktarıldı');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-xl font-bold">Ayarlar</h1>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {theme === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              Görünüm
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Koyu Tema</Label>
                <p className="text-sm text-muted-foreground">Gözlerinizi yormasın diye koyu tema kullanın</p>
              </div>
              <Switch 
                checked={theme === 'dark'} 
                onCheckedChange={toggleTheme}
              />
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle>Bildirimler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Maç Bildirimleri</Label>
                <p className="text-sm text-muted-foreground">Maç başlamadan önce bildirim al</p>
              </div>
              <Switch defaultChecked />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Antrenman Bildirimleri</Label>
                <p className="text-sm text-muted-foreground">Antrenman tamamlandığında bildirim al</p>
              </div>
              <Switch defaultChecked />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Transfer Bildirimleri</Label>
                <p className="text-sm text-muted-foreground">Transfer döneminde fırsatlar için bildirim al</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* Language & Region */}
        <Card>
          <CardHeader>
            <CardTitle>Dil ve Bölge</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Dil</Label>
              <Select defaultValue="tr">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tr">Türkçe</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Para Birimi</Label>
              <Select defaultValue="try">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="try">Türk Lirası (₺)</SelectItem>
                  <SelectItem value="eur">Euro (€)</SelectItem>
                  <SelectItem value="usd">US Dollar ($)</SelectItem>
                  <SelectItem value="gbp">British Pound (£)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Audio & Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5" />
              Ses ve Performans
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Ses Efektleri</Label>
                <p className="text-sm text-muted-foreground">Maç sırasında ses efektlerini oynat</p>
              </div>
              <Switch defaultChecked />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Animasyonlar</Label>
                <p className="text-sm text-muted-foreground">Geçiş animasyonlarını azalt</p>
              </div>
              <Switch />
            </div>
            
            <div className="space-y-2">
              <Label>Grafik Kalitesi</Label>
              <Select defaultValue="high">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Düşük</SelectItem>
                  <SelectItem value="medium">Orta</SelectItem>
                  <SelectItem value="high">Yüksek</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Veri Yönetimi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <Button 
                variant="outline" 
                className="w-full justify-start h-12"
                onClick={handleExportData}
              >
                <Download className="h-4 w-4 mr-2" />
                Verileri Dışa Aktar
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full justify-start h-12"
                onClick={handleClearCache}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Önbelleği Temizle
              </Button>
            </div>
            
            <div className="pt-4 border-t">
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>Oyun Verisi:</span>
                  <span>2.4 MB</span>
                </div>
                <div className="flex justify-between">
                  <span>Önbellek:</span>
                  <span>15.8 MB</span>
                </div>
                <div className="flex justify-between">
                  <span>Toplam:</span>
                  <span>18.2 MB</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle>Hakkında</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Versiyon:</span>
                <span>1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Son Güncelleme:</span>
                <span>18 Ağustos 2025</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Geliştirici:</span>
                <span>Turhan KAYAER</span>
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t">
              <div className="space-y-2">
                <Button variant="ghost" className="w-full justify-start text-sm p-0 h-auto">
                  Gizlilik Politikası
                </Button>
                <Button variant="ghost" className="w-full justify-start text-sm p-0 h-auto">
                  Kullanım Şartları
                </Button>
                <Button variant="ghost" className="w-full justify-start text-sm p-0 h-auto">
                  Destek
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}