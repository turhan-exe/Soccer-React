import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AppLogo from '@/components/AppLogo';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  saveRememberedCredentials,
} from '@/services/rememberedCredentials';
import { toast } from 'sonner';
import { Loader2, Chrome } from 'lucide-react';
import { FirebaseError } from 'firebase/app';

const getRegisterErrorMessage = (error: unknown): string => {
  if (error instanceof FirebaseError) {
    const map: Record<string, string> = {
      'auth/email-already-in-use': 'Bu e-posta adresi zaten kullanımda.',
      'auth/invalid-email': 'Geçerli bir e-posta adresi girin.',
      'auth/weak-password': 'Şifreniz en az 6 karakter olmalı.',
      'auth/operation-not-allowed': 'Kayıt işlemi devre dışı. Lütfen daha sonra tekrar deneyin.',
      'permission-denied': 'Takım oluşturulamadı. Lütfen tekrar deneyin.',
    };
    const friendly = map[error.code];
    if (friendly) {
      return friendly;
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Kayıt başarısız';
};

const getSocialAuthErrorMessage = (provider: 'google' | 'apple', error: unknown): string => {
  const normalizeMessage = (err: unknown) => {
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message?: string }).message ?? '');
    }
    if (typeof err === 'string') {
      return err;
    }
    return '';
  };

  const message = normalizeMessage(error).trim();
  const lowerMessage = message.toLowerCase();
  if (provider === 'google') {
    if (/^(10|12500):?/.test(message) || lowerMessage.includes('developer_error')) {
      return 'Google oturumu baslatilamadi. Firebase projenize Android release ve Play App Signing SHA-1/SHA-256 imzalarini ekleyip yeni google-services.json dosyasini indirerek projeye kopyalayin.';
    }
  }

  if (provider === 'apple') {
    if (
      lowerMessage.includes('invalid_oauth_response') ||
      lowerMessage.includes('invalid-oauth-response') ||
      lowerMessage.includes('invalid credential') ||
      lowerMessage.includes('invalid-credential')
    ) {
      return 'Apple girisi basarisiz. Firebase Console icinde Apple saglayicisini etkinlestirip Apple Service ID, Team ID, Key ID, private key ve return URL ayarlarinizi kontrol edin.';
    }
  }

  if (error instanceof FirebaseError) {
    const codeMap: Record<string, string> = {
      'auth/popup-blocked': 'Tarayici acilir pencere engellemesini kaldirin ve tekrar deneyin.',
      'auth/popup-closed-by-user': 'Oturum penceresini kapattiniz. Lutfen tekrar deneyin.',
      'auth/cancelled-popup-request': 'Baska bir oturum istegi zaten isleniyor. Lutfen tekrar deneyin.',
      'auth/network-request-failed': 'Ag istegi basarisiz oldu. Internet baglantisini kontrol edip tekrar deneyin.',
      'auth/invalid-oauth-client-id':
        provider === 'google'
          ? 'Google OAuth istemcisi gecersiz. Firebase projesine dogru SHA imzalarini ekleyip yeni google-services.json dosyasini indirin.'
          : 'Apple OAuth istemcisi gecersiz. Firebase Console icindeki Apple saglayici ayarlarini kontrol edin.',
      'auth/operation-not-allowed':
        provider === 'google'
          ? 'Firebase Authentication icinde Google girisi etkin degil. Firebase Console > Authentication > Sign-in method ekranindan Google saglayicisini acin.'
          : 'Firebase Authentication icinde Apple girisi etkin degil. Firebase Console > Authentication > Sign-in method ekranindan Apple saglayicisini acin.',
      'auth/unauthorized-domain':
        provider === 'google'
          ? 'Bu alan Google girisi icin yetkilendirilmemis. Firebase Authentication yetkili domainlerini kontrol edin.'
          : 'Bu alan Apple girisi icin yetkilendirilmemis. Firebase Authentication yetkili domainlerini ve Apple return URL ayarini kontrol edin.',
      'auth/invalid-credential':
        provider === 'google'
          ? 'Google oturum bilgileri gecersiz. Yeni google-services.json dosyasini alip uygulamayi yeniden derleyin.'
          : 'Apple oturum bilgileri gecersiz. Apple Service ID ve Firebase Apple provider ayarlarinizi kontrol edin.',
    };
    const friendly = codeMap[error.code];
    if (friendly) {
      return friendly;
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (message) {
    return message;
  }
  return provider === 'google' ? 'Google ile giriş başarısız' : 'Apple ile giriş başarısız';
};

const getPasswordResetErrorMessage = (error: unknown): string => {
  if (error instanceof FirebaseError) {
    const map: Record<string, string> = {
      'auth/invalid-email': 'Geçerli bir e-posta adresi girin.',
      'auth/user-not-found': 'Bu e-posta ile kayıtlı kullanıcı bulunamadı.',
      'auth/too-many-requests': 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.',
    };
    const friendly = map[error.code];
    if (friendly) {
      return friendly;
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Şifre sıfırlama bağlantısı gönderilemedi';
};

export default function Auth() {
  const {
    login,
    register,
    loginWithGoogle,
    loginWithApple,
    registerWithGoogle,
    registerWithApple,
    resetPassword,
    isLoading,
  } = useAuth();
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [registerForm, setRegisterForm] = useState({ email: '', password: '', teamName: '' });
  const [socialTeamName, setSocialTeamName] = useState('');
  const [socialProvider, setSocialProvider] = useState<'google' | 'apple' | null>(null);
  const [isSocialDialogOpen, setIsSocialDialogOpen] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const hydrateRememberedCredentials = async () => {
      const remembered = await loadRememberedCredentials();
      if (!remembered || cancelled) {
        return;
      }

      setLoginForm({
        email: remembered.email,
        password: remembered.password,
      });
      setRememberMe(true);
    };

    void hydrateRememberedCredentials();

    return () => {
      cancelled = true;
    };
  }, []);

  const legacyHandleLogin = async (e: React.FormEvent) => {
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.email || !loginForm.password) {
      toast.error('Lütfen tüm alanları doldurun');
      return;
    }

    try {
      await login(loginForm.email, loginForm.password);

      if (rememberMe) {
        await saveRememberedCredentials(loginForm.email, loginForm.password);
      } else {
        await clearRememberedCredentials();
      }

      toast.success('Başarıyla giriş yapıldı!');
      console.log('login ok:', loginForm.email);
    } catch (error) {
      toast.error('Giriş başarısız');
      console.error('login error:', error);
    }
  };

  const handleRememberMeChange = (checked: boolean | 'indeterminate') => {
    const nextValue = checked === true;
    setRememberMe(nextValue);

    if (!nextValue) {
      void clearRememberedCredentials();
    }
  };

  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = (resetEmail || loginForm.email).trim();
    if (!email) {
      toast.error('Lütfen e-posta adresinizi girin');
      return;
    }
    setIsSendingReset(true);
    try {
      await resetPassword(email);
      toast.success('Şifre sıfırlama bağlantısı e-postanıza gönderildi.');
      setIsResetDialogOpen(false);
    } catch (error) {
      toast.error(getPasswordResetErrorMessage(error));
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTeamName = registerForm.teamName.trim();
    if (!registerForm.email || !registerForm.password || !trimmedTeamName) {
      toast.error('Lütfen tüm alanları doldurun');
      return;
    }
    try {
      await register(registerForm.email, registerForm.password, trimmedTeamName);
      toast.success('Hesap başarıyla oluşturuldu!');
    } catch (error) {
      console.error('register error:', error);
      toast.error(getRegisterErrorMessage(error));
    }
  };

  const handleGoogleAuth = async () => {
    try {
      await loginWithGoogle();
      toast.success('Başarıyla giriş yapıldı!');
    } catch (error) {
      toast.error(getSocialAuthErrorMessage('google', error));
      console.error('google login error:', error);
    }
  };

  const handleAppleAuth = async () => {
    try {
      await loginWithApple();
      toast.success('Başarıyla giriş yapıldı!');
    } catch (error) {
      toast.error(getSocialAuthErrorMessage('apple', error));
      console.error('apple login error:', error);
    }
  };

  const openSocialRegister = (provider: 'google' | 'apple') => {
    setSocialProvider(provider);
    setSocialTeamName('');
    setIsSocialDialogOpen(true);
  };

  const handleSocialRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!socialProvider) return;

    const trimmedName = socialTeamName.trim();
    if (!trimmedName) {
      toast.error('Lütfen takım adınızı girin');
      return;
    }

    try {
      if (socialProvider === 'google') {
        await registerWithGoogle(trimmedName);
      } else {
        await registerWithApple(trimmedName);
      }
      toast.success('Hesap başarıyla oluşturuldu!');
      setIsSocialDialogOpen(false);
      setSocialProvider(null);
      setSocialTeamName('');
    } catch (error) {
      toast.error('Sosyal kayıt başarısız');
      console.error('social register error:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <AppLogo size="md" className="mx-auto" />
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
            FHS FUTBOL MENEJERLİK
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
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={rememberMe}
                      onCheckedChange={handleRememberMeChange}
                      disabled={isLoading}
                    />
                    <span>Beni Hatırla</span>
                  </label>
                  <Button
                    type="button"
                    variant="link"
                    className="px-0 text-xs"
                    onClick={() => {
                      setResetEmail(loginForm.email);
                      setIsResetDialogOpen(true);
                    }}
                    disabled={isLoading}
                  >
                    Şifremi Unuttum
                  </Button>
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
                  onClick={() => openSocialRegister('google')}
                  disabled={isLoading}
                >
                  <Chrome className="w-4 h-4 mr-2" />
                  Google ile Kayıt
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
      <Dialog
        open={isResetDialogOpen}
        onOpenChange={(open) => {
          setIsResetDialogOpen(open);
          if (!open) {
            setResetEmail('');
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handlePasswordReset} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Şifreyi Sıfırla</DialogTitle>
              <DialogDescription>
                Kayıtlı e-posta adresine sıfırlama bağlantısı göndereceğiz.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reset-email">E-posta</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="ornek@email.com"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                disabled={isSendingReset || isLoading}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsResetDialogOpen(false);
                  setResetEmail('');
                }}
                disabled={isSendingReset}
              >
                Vazgeç
              </Button>
              <Button type="submit" disabled={isSendingReset || isLoading}>
                {isSendingReset ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Bağlantı Gönder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={isSocialDialogOpen}
        onOpenChange={(open) => {
          setIsSocialDialogOpen(open);
          if (!open) {
            setSocialProvider(null);
            setSocialTeamName('');
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSocialRegister} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {socialProvider === 'google'
                  ? 'Google ile Kayıt'
                  : socialProvider === 'apple'
                    ? 'Apple ile Kayıt'
                    : 'Sosyal Kayıt'}
              </DialogTitle>
              <DialogDescription>
                Takımınız için özel bir isim belirleyin.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="social-team-name">Takım Adı</Label>
              <Input
                id="social-team-name"
                value={socialTeamName}
                onChange={(event) => setSocialTeamName(event.target.value)}
                placeholder="Takım adınızı girin"
                disabled={isLoading}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsSocialDialogOpen(false);
                  setSocialProvider(null);
                  setSocialTeamName('');
                }}
              >
                Vazgeç
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Kayıt Ol
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
