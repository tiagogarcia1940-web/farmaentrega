import type { IncomingMessage, ServerResponse } from 'node:http';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = 'gen-lang-client-0221522158';
const databaseId = 'ai-studio-4e28232f-7d94-4ae8-9c53-ed186154fdb3';
const maxBodyBytes = 1024 * 1024;
const allowedRoles = new Set(['admin', 'pharmacist']);

interface ProductRow {
  name: string;
  category: string;
  price: number;
  stock: number;
  originalPrice?: number | null;
  description?: string;
  barcode?: string;
  specifications?: string;
  howToUse?: string;
  tags?: string[];
  image?: string;
}

interface SyncReport {
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const getServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  const serviceAccount = JSON.parse(raw);
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return serviceAccount;
};

const getAdminApp = () => {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({ credential: cert(getServiceAccount()), projectId });
};

const sendJson = (res: ServerResponse, statusCode: number, body: unknown) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error('Arquivo muito grande para sincronizacao.');
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const normalizeNumber = (value: unknown) =>
  Number(String(value ?? '').replace(',', '.'));

const parseCSVText = (text: string): ProductRow[] => {
  const lines = text.split('\n').filter(line => line.trim());
  const rows: ProductRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const [name, category, priceRaw, stockRaw, description, barcode] = lines[i]
      .split(',')
      .map(value => value.trim());
    const price = normalizeNumber(priceRaw);
    const stock = parseInt(String(stockRaw), 10);

    if (!name || !category || Number.isNaN(price) || Number.isNaN(stock)) continue;
    rows.push({ name, category, price, stock, description, barcode });
  }

  return rows;
};

const normalizeProduct = (product: Record<string, unknown>): ProductRow => {
  const originalPriceRaw = product.originalPrice ?? product.original_price;
  const originalPrice = originalPriceRaw === undefined || originalPriceRaw === null || originalPriceRaw === ''
    ? null
    : normalizeNumber(originalPriceRaw);

  return {
    name: String(product.name || '').trim(),
    category: String(product.category || 'Medicamentos').trim(),
    price: normalizeNumber(product.price),
    stock: parseInt(String(product.stock ?? product.quantity ?? 0), 10),
    originalPrice: originalPrice === null || Number.isNaN(originalPrice) ? null : originalPrice,
    description: product.description ? String(product.description).trim() : '',
    barcode: product.barcode ? String(product.barcode).trim() : '',
    specifications: product.specifications ? String(product.specifications).trim() : '',
    howToUse: product.howToUse ? String(product.howToUse).trim() : '',
    tags: Array.isArray(product.tags)
      ? product.tags.map(tag => String(tag).trim()).filter(Boolean)
      : String(product.tags || '').split('|').map(tag => tag.trim()).filter(Boolean),
    image: product.image ? String(product.image).trim() : ''
  };
};

const validateInput = (body: unknown): { pharmacyId: string; products: ProductRow[] } => {
  if (typeof body !== 'object' || body === null) throw new Error('Body invalido.');
  const input = body as Record<string, unknown>;

  if (typeof input.pharmacyId !== 'string' || !input.pharmacyId.trim()) {
    throw new Error('pharmacyId obrigatorio.');
  }

  let products: ProductRow[];
  if (typeof input.csv === 'string') {
    products = parseCSVText(input.csv);
  } else if (Array.isArray(input.products)) {
    products = (input.products as Record<string, unknown>[])
      .map(normalizeProduct)
      .filter(product =>
        product.name &&
        product.category &&
        !Number.isNaN(product.price) &&
        !Number.isNaN(product.stock)
      );
  } else {
    throw new Error('Envie "csv" (texto) ou "products" (array).');
  }

  if (products.length === 0) throw new Error('Nenhum produto valido encontrado.');
  if (products.length > 5000) throw new Error('Maximo de 5000 produtos por sincronizacao.');

  return { pharmacyId: input.pharmacyId.trim(), products };
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const idToken = token.startsWith('Bearer ') ? token.slice(7) : '';
    if (!idToken) return sendJson(res, 401, { error: 'Login obrigatorio.' });

    const app = getAdminApp();
    const decodedToken = await getAuth(app).verifyIdToken(idToken);
    const role = decodedToken.role as string | undefined;

    if (!role || !allowedRoles.has(role)) {
      return sendJson(res, 403, { error: 'Sem permissao para sincronizar estoque.' });
    }

    const { pharmacyId, products } = validateInput(await readBody(req));

    if (role === 'pharmacist' && decodedToken.pharmacyId !== pharmacyId) {
      return sendJson(res, 403, { error: 'Voce so pode sincronizar sua propria farmacia.' });
    }

    const db = getFirestore(app, databaseId);
    const report: SyncReport = { added: 0, updated: 0, unchanged: 0, errors: [] };
    const existingSnap = await db
      .collection('products')
      .where('pharmacyId', '==', pharmacyId)
      .get();

    const byBarcode = new Map<string, { id: string; price: number; stock: number }>();
    const byName = new Map<string, { id: string; price: number; stock: number }>();

    existingSnap.forEach(docSnap => {
      const data = docSnap.data();
      const existing = {
        id: docSnap.id,
        price: Number(data.price || 0),
        stock: Number(data.stock ?? data.quantity ?? 0)
      };
      if (data.barcode) byBarcode.set(String(data.barcode), existing);
      if (data.name) byName.set(String(data.name).toLowerCase(), existing);
    });

    const batchSize = 400;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = db.batch();
      const slice = products.slice(i, i + batchSize);
      const now = Timestamp.now();

      for (const product of slice) {
        try {
          const existing =
            (product.barcode ? byBarcode.get(product.barcode) : undefined) ??
            byName.get(product.name.toLowerCase());

          if (existing) {
            const changed = existing.price !== product.price || existing.stock !== product.stock;
            if (!changed) {
              report.unchanged++;
              continue;
            }

            batch.set(
              db.doc(`products/${existing.id}`),
              {
                price: product.price,
                stock: product.stock,
                category: product.category,
                description: product.description || product.name,
                updatedAt: now,
                ...(product.originalPrice ? { originalPrice: product.originalPrice } : {}),
                ...(product.barcode ? { barcode: product.barcode } : {}),
                ...(product.specifications ? { specifications: product.specifications } : {}),
                ...(product.howToUse ? { howToUse: product.howToUse } : {}),
                ...(product.tags?.length ? { tags: product.tags } : {}),
                ...(product.image ? { image: product.image } : {})
              },
              { merge: true }
            );
            report.updated++;
          } else {
            const newRef = db.collection('products').doc();
            const newProduct = {
              pharmacyId,
              name: product.name,
              category: product.category,
              price: product.price,
              originalPrice: product.originalPrice || null,
              stock: product.stock,
              description: product.description || product.name,
              barcode: product.barcode || '',
              specifications: product.specifications || '',
              howToUse: product.howToUse || '',
              tags: product.tags || [],
              image: product.image || '',
              createdAt: now,
              updatedAt: now
            };

            batch.set(newRef, newProduct);
            report.added++;
            if (product.barcode) byBarcode.set(product.barcode, {
              id: newRef.id,
              price: product.price,
              stock: product.stock
            });
            byName.set(product.name.toLowerCase(), {
              id: newRef.id,
              price: product.price,
              stock: product.stock
            });
          }
        } catch (error) {
          report.errors.push(
            `${product.name}: ${error instanceof Error ? error.message : 'erro desconhecido'}`
          );
        }
      }

      await batch.commit();
    }

    return sendJson(res, 200, { ok: true, report });
  } catch (error) {
    console.error('sync-stock failed:', error);
    const message = error instanceof Error ? error.message : 'Erro ao sincronizar estoque.';
    return sendJson(res, 400, { error: message });
  }
}
