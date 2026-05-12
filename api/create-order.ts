import type { IncomingMessage, ServerResponse } from 'node:http';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = 'gen-lang-client-0221522158';
const databaseId = 'ai-studio-4e28232f-7d94-4ae8-9c53-ed186154fdb3';
const allowedPaymentMethods = new Set(['dinheiro', 'cartao', 'pix', 'convenio']);
const allowedDeliveryTypes = new Set(['normal', 'urgente', 'controlado']);
const maxBodyBytes = 32 * 1024;
const rateLimitWindowMs = 60 * 1000;
const maxOrdersPerWindow = 8;
const orderAttempts = new Map<string, { count: number; resetAt: number }>();

type CartInput = {
  productId: string;
  quantity: number;
};

type CreateOrderInput = {
  pharmacyId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentMethod: string;
  deliveryType: string;
  change?: number;
  cart: CartInput[];
};

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

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new Error('Pedido muito grande.');
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const sendJson = (res: ServerResponse, statusCode: number, body: unknown) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const normalizeQuantity = (quantity: unknown) => {
  const value = Number(quantity);
  if (!Number.isInteger(value) || value <= 0 || value > 99) {
    throw new Error('Quantidade invalida no carrinho.');
  }
  return value;
};

const checkRateLimit = (uid: string) => {
  const now = Date.now();
  const current = orderAttempts.get(uid);
  if (!current || current.resetAt <= now) {
    orderAttempts.set(uid, { count: 1, resetAt: now + rateLimitWindowMs });
    return;
  }

  if (current.count >= maxOrdersPerWindow) {
    throw new Error('Muitas tentativas de pedido. Aguarde um minuto e tente novamente.');
  }

  current.count += 1;
  orderAttempts.set(uid, current);
};

const validateInput = (body: Partial<CreateOrderInput>): CreateOrderInput => {
  if (!body.pharmacyId || typeof body.pharmacyId !== 'string') throw new Error('Farmacia invalida.');
  if (!body.customerName?.trim()) throw new Error('Nome do cliente obrigatorio.');
  if (!body.customerPhone?.trim()) throw new Error('WhatsApp obrigatorio.');
  if (!body.customerAddress?.trim()) throw new Error('Endereco obrigatorio.');
  if (!allowedPaymentMethods.has(String(body.paymentMethod))) throw new Error('Forma de pagamento invalida.');
  if (!allowedDeliveryTypes.has(String(body.deliveryType))) throw new Error('Tipo de entrega invalido.');
  if (!Array.isArray(body.cart) || body.cart.length === 0) throw new Error('Carrinho vazio.');
  if (body.cart.length > 100) throw new Error('Carrinho muito grande.');

  return {
    pharmacyId: body.pharmacyId.trim(),
    customerName: body.customerName.trim(),
    customerPhone: body.customerPhone.trim(),
    customerAddress: body.customerAddress.trim(),
    paymentMethod: String(body.paymentMethod),
    deliveryType: String(body.deliveryType),
    change: Number(body.change || 0),
    cart: body.cart.map(item => ({
      productId: String(item.productId || '').trim(),
      quantity: normalizeQuantity(item.quantity)
    }))
  };
};

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
    checkRateLimit(decodedToken.uid);
    const db = getFirestore(app, databaseId);
    const input = validateInput(await readBody(req));

    const result = await db.runTransaction(async transaction => {
      const pharmacyRef = db.doc(`pharmacies/${input.pharmacyId}`);
      const pharmacySnap = await transaction.get(pharmacyRef);
      if (!pharmacySnap.exists) throw new Error('Farmacia nao encontrada.');

      const productRefs = input.cart.map(item => db.doc(`products/${item.productId}`));
      const productSnaps = await Promise.all(productRefs.map(ref => transaction.get(ref)));

      let totalValue = 0;
      const itemDescriptions: string[] = [];

      productSnaps.forEach((snap, index) => {
        if (!snap.exists) throw new Error('Produto nao encontrado.');
        const product = snap.data() || {};
        const cartItem = input.cart[index];
        if (product.pharmacyId !== input.pharmacyId) throw new Error('Produto nao pertence a esta farmacia.');
        if (typeof product.price !== 'number' || product.price < 0) throw new Error('Preco de produto invalido.');
        if (typeof product.stock === 'number' && product.stock < cartItem.quantity) {
          throw new Error(`Estoque insuficiente para ${product.name || 'produto'}.`);
        }

        totalValue += product.price * cartItem.quantity;
        itemDescriptions.push(`${cartItem.quantity}x ${product.name || snap.id}`);
      });

      const change = input.paymentMethod === 'dinheiro' ? input.change : 0;
      if (change > 0 && change <= totalValue) {
        throw new Error('Valor para troco deve ser maior que o total do pedido.');
      }

      const counterRef = db.doc('counters/orders');
      const counterSnap = await transaction.get(counterRef);
      const nextNumber = (Number(counterSnap.data()?.lastNumber) || 0) + 1;
      const orderRef = db.collection('orders').doc();
      const now = Timestamp.now();

      transaction.set(counterRef, { lastNumber: nextNumber }, { merge: true });
      transaction.set(orderRef, {
        orderCode: String(nextNumber),
        customerName: input.customerName,
        customerAddress: input.customerAddress,
        customerPhone: input.customerPhone,
        customerId: decodedToken.uid,
        items: itemDescriptions.join(', '),
        totalValue: Number(totalValue.toFixed(2)),
        paymentMethod: input.paymentMethod,
        change,
        status: 'pending',
        pharmacyId: input.pharmacyId,
        deliveryType: input.deliveryType,
        createdAt: now,
        updatedAt: now
      });

      transaction.set(db.doc(`users/${decodedToken.uid}`), {
        phone: input.customerPhone,
        address: input.customerAddress,
        name: input.customerName,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return { orderId: orderRef.id, orderCode: String(nextNumber) };
    });

    return sendJson(res, 200, result);
  } catch (error) {
    console.error('create-order failed:', error);
    const message = error instanceof Error ? error.message : 'Erro ao criar pedido.';
    return sendJson(res, 400, { error: message });
  }
}
