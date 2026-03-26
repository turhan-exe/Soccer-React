import * as functions from 'firebase-functions/v1';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import { createHash } from 'crypto';
import '../_firebase.js';
import {
  assertSponsorActivationAllowed,
  buildSponsorActivationMutations,
} from './sponsorActivation.js';
import {
  buildSponsorProductId,
  getSponsorCatalogConfig,
  normalizeSponsorString,
  type SponsorCatalogConfig,
  type SponsorRewardCycle,
} from './sponsorCatalog.js';

const db = getFirestore();
const publisherAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

const PACKAGE_NAME = (process.env.ANDROID_PACKAGE_NAME || 'com.nerbuss.fhsmanager').trim();
const FINANCE_DEFAULT_BALANCE = 50_000;

const DIAMOND_PRODUCT_CONFIG = {
  diamonds_small: { packId: 'small', amount: 200 },
  diamonds_medium: { packId: 'medium', amount: 900 },
  diamonds_large: { packId: 'large', amount: 2800 },
  diamonds_mega: { packId: 'mega', amount: 6000 },
} as const;

const CREDIT_PRODUCT_CONFIG = {
  credits_10000: { packId: 'credit-10k', amount: 10_000 },
  credits_25000: { packId: 'credit-25k', amount: 25_000 },
  credits_60000: { packId: 'credit-60k', amount: 60_000 },
} as const;

type DiamondProductId = keyof typeof DIAMOND_PRODUCT_CONFIG;
type CreditProductId = keyof typeof CREDIT_PRODUCT_CONFIG;

type GooglePlayProductPurchase = {
  orderId?: string;
  purchaseState?: number;
  consumptionState?: number;
  acknowledgementState?: number;
  purchaseTimeMillis?: string;
  obfuscatedExternalAccountId?: string;
  obfuscatedExternalProfileId?: string;
  regionCode?: string;
  quantity?: number;
};

type ValidatedPurchaseInput = {
  uid: string;
  productId: string;
  purchaseToken: string;
  requestOrderId: string;
  requestPackageName: string;
};

const validateAuth = (context: functions.https.CallableContext): string => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Bu islem icin oturum acmaniz gerekir.');
  }
  return uid;
};

const getDiamondProductConfig = (productId: string) => {
  if (!(productId in DIAMOND_PRODUCT_CONFIG)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Bilinmeyen elmas urun kimligi gonderildi.',
    );
  }
  return DIAMOND_PRODUCT_CONFIG[productId as DiamondProductId];
};

const getCreditProductConfig = (productId: string) => {
  if (!(productId in CREDIT_PRODUCT_CONFIG)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Bilinmeyen kredi urun kimligi gonderildi.',
    );
  }
  return CREDIT_PRODUCT_CONFIG[productId as CreditProductId];
};

const getPublisherAccessToken = async (): Promise<string> => {
  const client = await publisherAuth.getClient();
  const token = await client.getAccessToken();
  const value = typeof token === 'string' ? token : token?.token;

  if (!value) {
    throw new functions.https.HttpsError(
      'internal',
      'Google Play Developer API icin erisim belirteci alinamadi.',
    );
  }

  return value;
};

const readApiErrorBody = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) {
    return '';
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return parsed.error?.message?.trim() || text;
  } catch {
    return text;
  }
};

const fetchGooglePlayPurchase = async (
  productId: string,
  purchaseToken: string,
): Promise<GooglePlayProductPurchase> => {
  const accessToken = await getPublisherAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      PACKAGE_NAME,
    )}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
      purchaseToken,
    )}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const detail = await readApiErrorBody(response);
    const message = detail || `Google Play purchase verify failed with HTTP ${response.status}.`;
    const code =
      response.status === 401 || response.status === 403 ? 'permission-denied' : 'failed-precondition';
    functions.logger.error('Google Play purchase verification failed', {
      packageName: PACKAGE_NAME,
      productId,
      status: response.status,
      code,
      detail,
    });
    throw new functions.https.HttpsError(code, message);
  }

  return (await response.json()) as GooglePlayProductPurchase;
};

const consumeGooglePlayPurchase = async (
  productId: string,
  purchaseToken: string,
): Promise<{ consumeAttempted: boolean; consumed: boolean; consumeError?: string | null }> => {
  const accessToken = await getPublisherAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      PACKAGE_NAME,
    )}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
      purchaseToken,
    )}:consume`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (response.ok) {
    return { consumeAttempted: true, consumed: true, consumeError: null };
  }

  const detail = await readApiErrorBody(response);
  return {
    consumeAttempted: true,
    consumed: false,
    consumeError: detail || `Google Play consume failed with HTTP ${response.status}.`,
  };
};

const parsePurchaseInput = (
  data: Record<string, unknown> | undefined,
  context: functions.https.CallableContext,
): ValidatedPurchaseInput => {
  const uid = validateAuth(context);
  const productId = normalizeSponsorString(data?.productId);
  const purchaseToken = normalizeSponsorString(data?.purchaseToken);
  const requestOrderId = normalizeSponsorString(data?.orderId);
  const requestPackageName = normalizeSponsorString(data?.packageName);

  if (!productId) {
    throw new functions.https.HttpsError('invalid-argument', 'productId zorunludur.');
  }
  if (!purchaseToken) {
    throw new functions.https.HttpsError('invalid-argument', 'purchaseToken zorunludur.');
  }
  if (requestPackageName && requestPackageName !== PACKAGE_NAME) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Uygulama paketi Play dogrulama ayarlariyla eslesmiyor.',
    );
  }

  return {
    uid,
    productId,
    purchaseToken,
    requestOrderId,
    requestPackageName,
  };
};

const verifyPurchaseForUser = async (
  input: ValidatedPurchaseInput,
): Promise<GooglePlayProductPurchase> => {
  const verifiedPurchase = await fetchGooglePlayPurchase(input.productId, input.purchaseToken);

  if (
    verifiedPurchase.obfuscatedExternalAccountId &&
    verifiedPurchase.obfuscatedExternalAccountId !== input.uid
  ) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Satin alma farkli bir kullanici hesabi ile eslestirilmis.',
    );
  }

  if (
    input.requestOrderId &&
    verifiedPurchase.orderId &&
    verifiedPurchase.orderId !== input.requestOrderId
  ) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Play siparis kimligi dogrulamasi basarisiz.',
    );
  }

  if (verifiedPurchase.purchaseState !== 0) {
    if (verifiedPurchase.purchaseState === 2) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Satin alma beklemede. Onaylanmadan odul verilemez.',
      );
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Play satin alma durumu uygun degil.',
    );
  }

  return verifiedPurchase;
};

const resolveTeamBalance = (
  teamData: { budget?: number; transferBudget?: number } | undefined,
  financeData: { balance?: number } | undefined,
): number => {
  const balanceSource = Number.isFinite(teamData?.transferBudget)
    ? Number(teamData?.transferBudget)
    : Number.isFinite(teamData?.budget)
      ? Number(teamData?.budget)
      : (financeData?.balance ?? FINANCE_DEFAULT_BALANCE);

  return Math.max(0, Math.round(balanceSource));
};

const getDiamondPurchaseRef = (uid: string, purchaseId: string) =>
  db.collection('users').doc(uid).collection('diamondPurchases').doc(purchaseId);

const getCreditPurchaseRef = (uid: string, purchaseId: string) =>
  db.collection('finance').doc('credits').collection(uid).doc(purchaseId);

const getFinanceHistoryRef = (uid: string) =>
  db.collection('finance').doc('history').collection(uid).doc();

const getSponsorPurchaseRef = (uid: string, purchaseId: string) =>
  db.collection('users').doc(uid).collection('sponsorPurchases').doc(purchaseId);

const finalizeConsumeState = async (
  productId: string,
  purchaseToken: string,
  purchaseRef: FirebaseFirestore.DocumentReference,
  verifiedPurchase: GooglePlayProductPurchase,
) => {
  let consumeAttempted = false;
  let consumed = verifiedPurchase.consumptionState === 1;
  let consumeError: string | null = null;

  if (!consumed) {
    const consumeResult = await consumeGooglePlayPurchase(productId, purchaseToken);
    consumeAttempted = consumeResult.consumeAttempted;
    consumed = consumeResult.consumed;
    consumeError = consumeResult.consumeError ?? null;

    await purchaseRef.set(
      {
        status: consumed ? 'consumed' : 'granted_pending_consume',
        consumptionState: consumed ? 1 : verifiedPurchase.consumptionState ?? 0,
        consumedAt: consumed ? FieldValue.serverTimestamp() : null,
        consumeError,
        lastVerifiedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return { consumeAttempted, consumed, consumeError };
};

export const finalizeAndroidDiamondPurchase = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const input = parsePurchaseInput(data as Record<string, unknown> | undefined, context);
    const product = getDiamondProductConfig(input.productId);
    const verifiedPurchase = await verifyPurchaseForUser(input);

    const purchaseId = createHash('sha256').update(input.purchaseToken).digest('hex');
    const userRef = db.collection('users').doc(input.uid);
    const purchaseRef = getDiamondPurchaseRef(input.uid, purchaseId);
    const economyRef = db.collection('economyLogs').doc();

    const quantity = Math.max(1, Number(verifiedPurchase.quantity ?? 1));
    const amount = product.amount * quantity;

    let diamondBalance = 0;
    let granted = false;
    let alreadyProcessed = false;

    await db.runTransaction(async (tx) => {
      const [userSnap, purchaseSnap] = await Promise.all([tx.get(userRef), tx.get(purchaseRef)]);
      const currentBalance = Number(userSnap.get('diamondBalance') ?? 0);

      if (purchaseSnap.exists) {
        diamondBalance = currentBalance;
        alreadyProcessed = true;
        tx.set(
          purchaseRef,
          {
            lastVerifiedAt: FieldValue.serverTimestamp(),
            purchaseState: verifiedPurchase.purchaseState ?? null,
            consumptionState: verifiedPurchase.consumptionState ?? null,
            acknowledgementState: verifiedPurchase.acknowledgementState ?? null,
            orderId: verifiedPurchase.orderId ?? null,
          },
          { merge: true },
        );
        return;
      }

      diamondBalance = Math.max(0, Math.round(currentBalance + amount));
      granted = true;

      tx.set(
        userRef,
        {
          diamondBalance,
        },
        { merge: true },
      );

      tx.set(purchaseRef, {
        purchaseId,
        uid: input.uid,
        packId: product.packId,
        productId: input.productId,
        amount,
        quantity,
        paymentMethod: 'google-play',
        status: 'granted_pending_consume',
        packageName: PACKAGE_NAME,
        orderId: verifiedPurchase.orderId ?? null,
        purchaseTokenHash: purchaseId,
        purchaseState: verifiedPurchase.purchaseState ?? null,
        consumptionState: verifiedPurchase.consumptionState ?? null,
        acknowledgementState: verifiedPurchase.acknowledgementState ?? null,
        purchaseTimeMillis: verifiedPurchase.purchaseTimeMillis ?? null,
        obfuscatedExternalAccountId: verifiedPurchase.obfuscatedExternalAccountId ?? null,
        obfuscatedExternalProfileId: verifiedPurchase.obfuscatedExternalProfileId ?? null,
        regionCode: verifiedPurchase.regionCode ?? null,
        createdAt: FieldValue.serverTimestamp(),
        grantedAt: FieldValue.serverTimestamp(),
        lastVerifiedAt: FieldValue.serverTimestamp(),
      });

      tx.set(economyRef, {
        userId: input.uid,
        action: 'diamondPurchase',
        purchaseId,
        productId: input.productId,
        packId: product.packId,
        amount,
        paymentMethod: 'google-play',
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    const consumeState = await finalizeConsumeState(
      input.productId,
      input.purchaseToken,
      purchaseRef,
      verifiedPurchase,
    );

    return {
      purchaseId,
      productId: input.productId,
      packId: product.packId,
      amount,
      diamondBalance,
      granted,
      alreadyProcessed,
      ...consumeState,
    };
  });

export const finalizeAndroidCreditPurchase = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const input = parsePurchaseInput(data as Record<string, unknown> | undefined, context);
    const product = getCreditProductConfig(input.productId);
    const verifiedPurchase = await verifyPurchaseForUser(input);

    const purchaseId = createHash('sha256').update(input.purchaseToken).digest('hex');
    const financeRef = db.collection('finance').doc(input.uid);
    const teamRef = db.collection('teams').doc(input.uid);
    const purchaseRef = getCreditPurchaseRef(input.uid, purchaseId);
    const historyRef = getFinanceHistoryRef(input.uid);

    const quantity = Math.max(1, Number(verifiedPurchase.quantity ?? 1));
    const amount = product.amount * quantity;

    let balance = 0;
    let granted = false;
    let alreadyProcessed = false;

    await db.runTransaction(async (tx) => {
      const [financeSnap, teamSnap, purchaseSnap] = await Promise.all([
        tx.get(financeRef),
        tx.get(teamRef),
        tx.get(purchaseRef),
      ]);

      const financeData = (financeSnap.data() as { balance?: number } | undefined) ?? undefined;
      const teamData =
        (teamSnap.data() as { budget?: number; transferBudget?: number } | undefined) ?? undefined;
      const currentBalance = resolveTeamBalance(teamData, financeData);

      if (purchaseSnap.exists) {
        balance = currentBalance;
        alreadyProcessed = true;
        tx.set(
          purchaseRef,
          {
            lastVerifiedAt: FieldValue.serverTimestamp(),
            purchaseState: verifiedPurchase.purchaseState ?? null,
            consumptionState: verifiedPurchase.consumptionState ?? null,
            acknowledgementState: verifiedPurchase.acknowledgementState ?? null,
            orderId: verifiedPurchase.orderId ?? null,
          },
          { merge: true },
        );
        return;
      }

      balance = Math.max(0, Math.round(currentBalance + amount));
      granted = true;

      tx.set(
        financeRef,
        {
          balance,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(
        teamRef,
        {
          budget: balance,
          transferBudget: balance,
        },
        { merge: true },
      );

      tx.set(purchaseRef, {
        id: purchaseId,
        purchaseId,
        uid: input.uid,
        packageId: product.packId,
        productId: input.productId,
        amount,
        quantity,
        price: null,
        paymentMethod: 'google-play',
        status: 'granted_pending_consume',
        packageName: PACKAGE_NAME,
        orderId: verifiedPurchase.orderId ?? null,
        purchaseTokenHash: purchaseId,
        purchaseState: verifiedPurchase.purchaseState ?? null,
        consumptionState: verifiedPurchase.consumptionState ?? null,
        acknowledgementState: verifiedPurchase.acknowledgementState ?? null,
        purchaseTimeMillis: verifiedPurchase.purchaseTimeMillis ?? null,
        obfuscatedExternalAccountId: verifiedPurchase.obfuscatedExternalAccountId ?? null,
        obfuscatedExternalProfileId: verifiedPurchase.obfuscatedExternalProfileId ?? null,
        regionCode: verifiedPurchase.regionCode ?? null,
        createdAt: FieldValue.serverTimestamp(),
        purchasedAt: FieldValue.serverTimestamp(),
        grantedAt: FieldValue.serverTimestamp(),
        lastVerifiedAt: FieldValue.serverTimestamp(),
      });

      tx.set(historyRef, {
        id: historyRef.id,
        type: 'income',
        category: 'loan',
        amount,
        source: product.packId,
        note: `Kredi paketi (${product.packId})`,
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    const consumeState = await finalizeConsumeState(
      input.productId,
      input.purchaseToken,
      purchaseRef,
      verifiedPurchase,
    );

    return {
      purchaseId,
      productId: input.productId,
      packId: product.packId,
      amount,
      balance,
      granted,
      alreadyProcessed,
      ...consumeState,
    };
  });

export const finalizeAndroidSponsorPurchase = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    const sponsorId = normalizeSponsorString(data?.sponsorId);
    if (!sponsorId) {
      throw new functions.https.HttpsError('invalid-argument', 'sponsorId zorunludur.');
    }

    const input = parsePurchaseInput(data as Record<string, unknown> | undefined, context);
    const sponsorConfig = await getSponsorCatalogConfig(sponsorId);
    assertSponsorActivationAllowed('premium', sponsorConfig);
    if (!sponsorConfig.storeProductId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Sponsor icin Play urun kimligi tanimlanmamis.',
      );
    }
    if (input.productId !== sponsorConfig.storeProductId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Sponsor urun kimligi Play Store urunu ile eslesmiyor.',
      );
    }

    const verifiedPurchase = await verifyPurchaseForUser(input);
    const quantity = Math.max(1, Number(verifiedPurchase.quantity ?? 1));
    if (quantity > 1) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Sponsor satin almalari tekil olmalidir.',
      );
    }

    const purchaseId = createHash('sha256').update(input.purchaseToken).digest('hex');
    const purchaseRef = getSponsorPurchaseRef(input.uid, purchaseId);
    const sponsorshipsQuery = db.collection('users').doc(input.uid).collection('sponsorships');

    let granted = false;
    let alreadyProcessed = false;

    await db.runTransaction(async (tx) => {
      const [purchaseSnap, sponsorshipsSnap] = await Promise.all([
        tx.get(purchaseRef),
        tx.get(sponsorshipsQuery),
      ]);

      if (purchaseSnap.exists) {
        alreadyProcessed = true;
        tx.set(
          purchaseRef,
          {
            lastVerifiedAt: FieldValue.serverTimestamp(),
            purchaseState: verifiedPurchase.purchaseState ?? null,
            consumptionState: verifiedPurchase.consumptionState ?? null,
            acknowledgementState: verifiedPurchase.acknowledgementState ?? null,
            orderId: verifiedPurchase.orderId ?? null,
          },
          { merge: true },
        );
        return;
      }

      granted = true;
      const mutations = buildSponsorActivationMutations(
        sponsorshipsSnap.docs.map((docSnap) => docSnap.id),
        sponsorConfig,
        FieldValue.serverTimestamp(),
      );
      const refById = new Map(sponsorshipsSnap.docs.map((docSnap) => [docSnap.id, docSnap.ref]));
      mutations.forEach((mutation) => {
        const ref = refById.get(mutation.sponsorId) ?? sponsorshipsQuery.doc(mutation.sponsorId);
        tx.set(ref, mutation.payload, { merge: true });
      });

      tx.set(purchaseRef, {
        purchaseId,
        uid: input.uid,
        sponsorId,
        sponsorName: sponsorConfig.sponsorName,
        catalogId: sponsorConfig.catalogId,
        productId: input.productId,
        quantity,
        paymentMethod: 'google-play',
        status: 'granted_pending_consume',
        packageName: PACKAGE_NAME,
        orderId: verifiedPurchase.orderId ?? null,
        purchaseTokenHash: purchaseId,
        purchaseState: verifiedPurchase.purchaseState ?? null,
        consumptionState: verifiedPurchase.consumptionState ?? null,
        acknowledgementState: verifiedPurchase.acknowledgementState ?? null,
        purchaseTimeMillis: verifiedPurchase.purchaseTimeMillis ?? null,
        obfuscatedExternalAccountId: verifiedPurchase.obfuscatedExternalAccountId ?? null,
        obfuscatedExternalProfileId: verifiedPurchase.obfuscatedExternalProfileId ?? null,
        regionCode: verifiedPurchase.regionCode ?? null,
        createdAt: FieldValue.serverTimestamp(),
        grantedAt: FieldValue.serverTimestamp(),
        lastVerifiedAt: FieldValue.serverTimestamp(),
      });
    });

    const consumeState = await finalizeConsumeState(
      input.productId,
      input.purchaseToken,
      purchaseRef,
      verifiedPurchase,
    );

    return {
      purchaseId,
      sponsorId,
      sponsorName: sponsorConfig.sponsorName,
      productId: input.productId,
      granted,
      alreadyProcessed,
      ...consumeState,
    };
  });
