import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Chrome, Apple } from 'lucide-react';

export default function Auth() {
  const { login, register, loginWithGoogle, loginWithApple, isLoading } = useAuth();
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ email: '', password: '', teamName: '' });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.email || !loginForm.password) {
      toast.error('Lütfen tüm alanları doldurun');
      return;
    }
    try {
      await login(loginForm.email, loginForm.password);
      
      toast.success('Başarıyla giriş yapıldı!');
       console.log("login ok:", loginForm.email);
    } catch (error) {
      toast.error('Giriş başarısız');
      console.error("login error:", error);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerForm.email || !registerForm.password || !registerForm.teamName) {
      toast.error('Lütfen tüm alanları doldurun');
      return;
    }
    try {
      await register(registerForm.email, registerForm.password, registerForm.teamName);
      toast.success('Hesap başarıyla oluşturuldu!');
    } catch (error) {
      toast.error('Kayıt başarısız');
    }
  };

  const handleGoogleAuth = async () => {
    try {
      await loginWithGoogle();
      toast.success('Başarıyla giriş yapıldı!');
    } catch (error) {
      toast.error('Google ile giriş başarısız');
      console.error('google login error:', error);
    }
  };

  const handleAppleAuth = async () => {
    try {
      await loginWithApple();
      toast.success('Başarıyla giriş yapıldı!');
    } catch (error) {
      toast.error('Apple ile giriş başarısız');
      console.error('apple login error:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="text-4xl mb-2">⚽</div>
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
            Futbol Menajerliği
          </CardTitle>
          <CardDescription>
            Takımınızı yönetin ve şampiyonluğa ulaşın
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Giriş Yap</TabsTrigger>
              <TabsTrigger value="register">Kayıt Ol</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">E-posta</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="ornek@email.com"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Şifre</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    disabled={isLoading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Giriş Yap
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">veya</span>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleGoogleAuth}
                  disabled={isLoading}
                >
                  <Chrome className="w-4 h-4 mr-2" />
                  Google ile Giriş
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleAppleAuth}
                  disabled={isLoading}
                >
                  <Apple className="w-4 h-4 mr-2" />
                  Apple ile Giriş
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="register" className="space-y-4">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="register-email">E-posta</Label>
                  <Input
                    id="register-email"
                    type="email"
                    placeholder="ornek@email.com"
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">Şifre</Label>
                  <Input
                    id="register-password"
                    type="password"
                    placeholder="••••••••"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-name">Takım Adı</Label>
                  <Input
                    id="team-name"
                    placeholder="Takım adınızı girin"
                    value={registerForm.teamName}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, teamName: e.target.value }))}
                    disabled={isLoading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Hesap Oluştur
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">veya</span>
                </div>
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleGoogleAuth}
                  disabled={isLoading}
                >
                  <Chrome className="w-4 h-4 mr-2" />
                  Google ile Kayıt
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleAppleAuth}
                  disabled={isLoading}
                >
                  <Apple className="w-4 h-4 mr-2" />
                  Apple ile Kayıt
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-6 text-center text-xs text-muted-foreground">
            Kayıt olarak{' '}
            <a href="#" className="underline underline-offset-4 hover:text-primary">
              Gizlilik Politikası
            </a>{' '}
            ve{' '}
            <a href="#" className="underline underline-offset-4 hover:text-primary">
              Kullanım Şartları
            </a>
            'nı kabul etmiş olursunuz.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}