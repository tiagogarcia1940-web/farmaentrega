import type { IncomingMessage, ServerResponse } from 'node:http';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'gen-lang-client-0221522158';
const databaseId = 'ai-studio-4e28232f-7d94-4ae8-9c53-ed186154fdb3';
const defaultPharmacyId = 'farmaentrega-matriz';
const allowedRoles = new Set(['admin', 'pharmacist', 'logistics', 'motoboy', 'client']);

const getServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const serviceAccount = JSON.parse(raw);
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return serviceAccount;
};

const getAdminApp = () => {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert(getServiceAccount()),
    projectId
  });
};

const sendJson = (res: ServerResponse, statusCode: number, body: unknown) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const sameClaims = (current: Record<string, unknown>, next: Record<string, unknown>) =>
  current.role === next.role &&
  current.pharmacyId === next.pharmacyId &&
  current.admin === next.admin &&
  current.platformAdmin === next.platformAdmin;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const idToken = token.startsWith('Bearer ') ? token.slice(7) : '';
    if (!idToken) return sendJson(res, 401, { error: 'Login obrigatorio.' });

    const app = getAdminApp();
    const auth = getAuth(app);
    const decodedToken = await auth.verifyIdToken(idToken);
    const db = getFirestore(app, databaseId);
    const userSnap = await db.doc(`users/${decodedToken.uid}`).get();
    if (!userSnap.exists) {
      return sendJson(res, 404, { error: 'Usuario nao encontrado.' });
    }

    const user = userSnap.data() || {};
    const role = allowedRoles.has(String(user.role)) ? String(user.role) : 'client';
    const pharmacyId = typeof user.pharmacyId === 'string' && user.pharmacyId.trim()
      ? user.pharmacyId.trim()
      : defaultPharmacyId;
    const nextClaims = {
      role,
      pharmacyId,
      admin: role === 'admin',
      platformAdmin: role === 'admin'
    };

    const currentClaims = (await auth.getUser(decodedToken.uid)).customClaims || {};
    if (!sameClaims(currentClaims, nextClaims)) {
      await auth.setCustomUserClaims(decodedToken.uid, {
        ...currentClaims,
        ...nextClaims
      });
    }

    return sendJson(res, 200, { ok: true, claimsUpdated: !sameClaims(currentClaims, nextClaims) });
  } catch (error) {
    console.error('sync-claims failed:', error);
    const message = error instanceof Error ? error.message : 'Erro ao sincronizar permissoes.';
    return sendJson(res, 400, { error: message });
  }
}
