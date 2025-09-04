import * as functions from 'firebase-functions';

export function requireAuth(ctx: functions.https.CallableContext) {
  if (!ctx.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
}

export function requireAppCheck(ctx: functions.https.CallableContext) {
  // Support both v1 and v2 context shapes
  const appCheck = (ctx as any)?.appCheckToken || (ctx as any)?.app;
  if (!appCheck) {
    throw new functions.https.HttpsError('failed-precondition', 'AppCheck required');
  }
}

