import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';
import { toast } from '@/components/ui/sonner';

const BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL || '';

export async function callFn<TReq = any, TRes = any>(
  name: string,
  data?: TReq
): Promise<TRes> {
  try {
    const fn = httpsCallable<TReq, TRes>(functions, name);
    const res = await fn(data as TReq);
    return res.data as TRes;
  } catch (err: any) {
    // Surface meaningful errors
    console.error(`[callable:${name}]`, err);
    const msg = err?.message || `Fonksiyon hatası: ${name}`;
    try {
      toast.error(msg);
    } catch {}
    throw err;
  }
}

export async function httpPost<TRes = any>(path: string, body?: any): Promise<TRes> {
  if (!BASE_URL) {
    const err = new Error(
      'VITE_FUNCTIONS_BASE_URL tanımlı değil (HTTP fallback için gerekli).'
    );
    try {
      toast.error(err.message);
    } catch {}
    throw err;
  }
  try {
    const idToken = await auth.currentUser?.getIdToken?.();
    const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as TRes;
  } catch (err: any) {
    console.error(`[http:${path}]`, err);
    const msg = err?.message || `HTTP hata: ${path}`;
    try {
      toast.error(msg);
    } catch {}
    throw err;
  }
}

