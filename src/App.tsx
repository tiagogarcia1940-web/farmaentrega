import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { 
  BrowserRouter, 
  Routes, 
  Route, 
  Navigate, 
  Link, 
  useNavigate, 
  useLocation 
} from 'react-router-dom';
import { 
  auth, db 
} from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider, 
  signOut,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  updateDoc,
  deleteDoc,
  limit,
  serverTimestamp,
  Timestamp,
  getDocFromServer,
  runTransaction
} from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Bike,
  Package, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Map,
  Plus, 
  Minus,
  LogOut, 
  User as UserIcon,
  Navigation,
  Phone,
  Search,
  Camera,
  MessageSquare,
  QrCode,
  ScanLine,
  Settings as SettingsIcon,
  Shield,
  Key,
  Mail,
  Smartphone,
  ChevronDown,
  Edit,
  Trash2,
  Home,
  ShoppingCart,
  Store,
  UserCircle,
  ArrowRight,
  ArrowLeft,
  Stethoscope,
  Box,
  History,
  Droplets,
  Heart,
  Zap,
  ShieldCheck,
  Menu,
  X,
  AlertTriangle,
  XCircle,
  Upload,
  Download,
  Link as LinkIcon
} from 'lucide-react';
import * as Papa from 'papaparse';
import { QRCodeCanvas } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { cn, isValidEmail } from './lib/utils';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';

// Fix for default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Helper to update map center
const ChangeView = ({ center }: { center: [number, number] }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [map, center]);
  return null;
};

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentUser = auth.currentUser;
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo: currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Detail:', errInfo);

  if (
    errorCode === 'permission-denied' &&
    (operationType === OperationType.LIST || operationType === OperationType.GET)
  ) {
    console.warn('Leitura bloqueada apos mudanca de permissao. A tela seguira sem recarregar.', errInfo);
    return;
  }

  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---

type OrderStatus = 'pending' | 'approved' | 'ready' | 'in_transit' | 'delivered' | 'cancelled';
type DeliveryType = 'normal' | 'urgente' | 'controlado';
type PaymentMethod = 'dinheiro' | 'cartao' | 'pix' | 'convenio';
const DEFAULT_PHARMACY_ID = 'farmaentrega-matriz';

const paymentMethodLabels: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  cartao: 'Cartao',
  pix: 'PIX',
  convenio: 'Convenio / deixar na conta'
};

const paymentMethods: PaymentMethod[] = ['pix', 'cartao', 'dinheiro', 'convenio'];

const money = (value?: number) =>
  Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const getChangeDue = (order: Pick<Order, 'paymentMethod' | 'change' | 'totalValue'>) => {
  if (order.paymentMethod !== 'dinheiro') return 0;
  const changeFor = Number(order.change || 0);
  const totalValue = Number(order.totalValue || 0);
  return changeFor > totalValue ? Number((changeFor - totalValue).toFixed(2)) : 0;
};

const getChangeLabel = (order: Pick<Order, 'paymentMethod' | 'change' | 'totalValue'>) => {
  if (order.paymentMethod !== 'dinheiro') return 'Sem troco';
  const changeFor = Number(order.change || 0);
  const changeDue = getChangeDue(order);
  if (!changeFor || !changeDue) return 'Sem troco';
  return `Troco para R$ ${money(changeFor)} • Levar R$ ${money(changeDue)}`;
};

interface Order {
  id: string;
  orderCode: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  items: string;
  change?: number;
  paymentMethod?: PaymentMethod;
  totalValue?: number;
  status: OrderStatus;
  deliveryType?: DeliveryType;
  deliveryLocation?: string;
  pharmacistId?: string;
  logisticsId?: string;
  motoboyId?: string;
  motoboyName?: string;
  location?: { lat: number; lng: number };
  customerLocation?: { lat: number; lng: number };
  createdAt: Timestamp;
  approvedAt?: Timestamp;
  inTransitAt?: Timestamp;
  deliveredAt?: Timestamp;
  updatedAt?: Timestamp;
  notificationSent?: boolean;
  deliveryProof?: {
    photoUrl?: string;
    description?: string;
    timestamp: Timestamp;
  };
  customerId?: string;
  cancellationReason?: string;
  pharmacyId?: string;
}

interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: 'admin' | 'pharmacist' | 'motoboy' | 'client';
  photoURL?: string;
  status?: 'available' | 'busy' | 'offline';
  phone?: string;
  address?: string;
  pharmacyId?: string;
}

interface PharmacySignupData {
  name: string;
  cnpj: string;
  openingHours: string;
}

interface PharmacyProfile {
  pharmacyId: string;
  ownerId?: string;
  name: string;
  cnpj: string;
  openingHours: string;
  title: string;
  description: string;
  deliveryTime: string;
  heroImage: string;
  pixKey: string;
}

const getPharmacyId = (user?: AppUser | null) => user?.pharmacyId || DEFAULT_PHARMACY_ID;

const getInitialPharmacyId = (uid: string, role?: AppUser['role'], isAdmin = false) => {
  if (isAdmin || role === 'client' || !role) return DEFAULT_PHARMACY_ID;
  return `pharmacy_${uid}`;
};

const getDefaultPharmacyProfile = (
  pharmacyId: string,
  ownerId?: string,
  data?: Partial<PharmacySignupData>
): PharmacyProfile => ({
  pharmacyId,
  ownerId,
  name: data?.name || 'Farmacia',
  cnpj: data?.cnpj || '',
  openingHours: data?.openingHours || 'Segunda a sabado, 08:00 as 20:00',
  title: data?.name ? `${data.name} Online` : 'Cuidamos de voce em tempo recorde.',
  description: 'A farmacia online que entende a sua urgencia. Produtos com entrega em ate {time}.',
  deliveryTime: '40 minutos',
  heroImage: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=1200&h=600&fit=crop',
  pixKey: ''
});

const GOOGLE_LOGIN_ROLE_KEY = 'farmaentrega.googleLoginRole';

const getStoredGoogleLoginRole = (): AppUser['role'] | undefined => {
  if (typeof window === 'undefined') return undefined;
  const role = window.sessionStorage.getItem(GOOGLE_LOGIN_ROLE_KEY);
  return role === 'admin' || role === 'pharmacist' || role === 'motoboy' || role === 'client' ? role : undefined;
};

const storeGoogleLoginRole = (role?: AppUser['role']) => {
  if (typeof window === 'undefined') return;
  if (role) {
    window.sessionStorage.setItem(GOOGLE_LOGIN_ROLE_KEY, role);
  } else {
    window.sessionStorage.removeItem(GOOGLE_LOGIN_ROLE_KEY);
  }
};

interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  category: string;
  requiresApproval?: boolean;
}

interface Product {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  category: string;
  image: string;
  description: string;
  specifications?: string;
  howToUse?: string;
  tags?: string[];
  requiresApproval?: boolean;
  stock?: number;
  pharmacyId?: string;
}

interface Notification {
  id: string;
  orderId: string;
  message: string;
  timestamp: number;
  type: 'info' | 'success' | 'warning';
}

// --- Context ---

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  signIn: (role?: AppUser['role']) => Promise<void>;
  signInWithEmail: (email: string, pass: string, role?: AppUser['role']) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, role: AppUser['role'], pharmacyData?: PharmacySignupData) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (data: { name?: string, photoURL?: string }) => Promise<void>;
  updateUserPassword: (pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setError(event.error?.message || 'Ocorreu um erro inesperado.');
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Ops! Algo deu errado</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            Recarregar Aplicativo
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const AppUpdateNotice = () => {
  const [showUpdatedNotice, setShowUpdatedNotice] = useState(false);
  const {
    offlineReady: [offlineReady, setOfflineReady]
  } = useRegisterSW({
    immediate: true,
    onNeedReload() {
      window.location.reload();
    },
    onRegisteredSW(_swScriptUrl, registration) {
      if (!registration) return;
      const interval = window.setInterval(() => {
        registration.update().catch(error => {
          console.error('Erro ao verificar atualização do PWA:', error);
        });
      }, 60 * 1000);

      window.addEventListener('beforeunload', () => window.clearInterval(interval), { once: true });
    },
    onRegisterError(error) {
      console.error('Erro ao registrar PWA:', error);
    }
  });

  useEffect(() => {
    const storageKey = 'farmaentrega.appVersion';
    const previousVersion = window.localStorage.getItem(storageKey);
    window.localStorage.setItem(storageKey, __APP_VERSION__);

    if (previousVersion && previousVersion !== __APP_VERSION__) {
      setShowUpdatedNotice(true);
    }
  }, []);

  if (!showUpdatedNotice && !offlineReady) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-[9999] mx-auto max-w-xl rounded-2xl border border-indigo-100 bg-white p-4 shadow-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-gray-900">
            {showUpdatedNotice ? 'Aplicativo atualizado' : 'Aplicativo pronto para usar offline'}
          </p>
          <p className="text-xs font-medium text-gray-500">
            {showUpdatedNotice
              ? 'A versão mais recente do FarmaEntrega já está carregada.'
              : 'Os arquivos principais foram salvos neste dispositivo.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setShowUpdatedNotice(false);
              setOfflineReady(false);
            }}
            className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-500"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Components ---

const QRScanner = ({ onScan, onClose }: { onScan: (data: string) => void; onClose: () => void }) => {
  const readerIdRef = useRef(`reader-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const scanner = new Html5Qrcode(readerIdRef.current, false);
    scannerRef.current = scanner;

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
      async (decodedText) => {
        if (stopped) return;
        stopped = true;
        try {
          await scanner.stop();
          scanner.clear();
        } catch (error) {
          console.error('Erro ao fechar leitor de QR:', error);
        }
        onScan(decodedText);
      },
      () => {}
    ).catch((error) => {
      console.error('Erro ao abrir camera para QR:', error);
      if (!stopped) {
        setCameraError('Nao foi possivel abrir a camera. Verifique a permissao da camera no navegador e tente novamente.');
      }
    });

    return () => {
      stopped = true;
      const activeScanner = scannerRef.current;
      scannerRef.current = null;
      if (!activeScanner) return;
      activeScanner.stop()
        .catch(() => undefined)
        .finally(() => {
          try {
            activeScanner.clear();
          } catch (error) {
            console.error('Erro ao limpar leitor de QR:', error);
          }
        });
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black/80 flex flex-col items-center justify-center z-[100] p-4">
      <div className="bg-white w-full max-w-md rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <ScanLine className="text-indigo-600" size={20} /> Escanear Pedido
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <div id={readerIdRef.current} className="min-h-[320px] w-full bg-black"></div>
        <div className="p-4 text-center text-sm text-gray-500">
          {cameraError && <p className="mb-2 font-bold text-red-600">{cameraError}</p>}
          Aponte a câmera para o QR Code do pedido impresso.
        </div>
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: OrderStatus }) => {
  const styles = {
    pending: "bg-amber-100 text-amber-700 border-amber-200",
    approved: "bg-blue-100 text-blue-700 border-blue-200",
    ready: "bg-indigo-100 text-indigo-700 border-indigo-200",
    in_transit: "bg-emerald-100 text-emerald-700 border-emerald-200",
    delivered: "bg-gray-100 text-gray-700 border-gray-200",
    cancelled: "bg-red-100 text-red-700 border-red-200",
  };

  const labels = {
    pending: "Aguardando Aprovação",
    approved: "Preparando",
    ready: "Pedido Pronto",
    in_transit: "Em Rota",
    delivered: "Entregue",
    cancelled: "Cancelado",
  };

  return (
    <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border whitespace-nowrap inline-flex items-center justify-center", styles[status])}>
      {labels[status]}
    </span>
  );
};

const HoldButton = ({ 
  onComplete, 
  children, 
  className, 
  disabled,
  duration = 2000 
}: { 
  onComplete: () => void, 
  children: React.ReactNode, 
  className?: string,
  disabled?: boolean,
  duration?: number
}) => {
  const [isHolding, setIsHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);

  const animate = (time: number) => {
    if (!startTimeRef.current) startTimeRef.current = time;
    const elapsed = time - startTimeRef.current;
    const nextProgress = Math.min((elapsed / duration) * 100, 100);
    
    setProgress(nextProgress);

    if (nextProgress < 100) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      onComplete();
      stopHold();
    }
  };

  const startHold = (e: any) => {
    if (disabled) return;
    setIsHolding(true);
    setProgress(0);
    startTimeRef.current = 0;
    requestRef.current = requestAnimationFrame(animate);
  };

  const stopHold = () => {
    setIsHolding(false);
    setProgress(0);
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={stopHold}
      onMouseLeave={stopHold}
      onTouchStart={startHold}
      onTouchEnd={stopHold}
      className={cn("relative overflow-hidden group transition-all active:scale-[0.98]", className)}
      disabled={disabled}
      style={{ isolation: 'isolate' }}
    >
      <div className="relative z-10 flex items-center justify-center gap-2 w-full h-full py-3">
        {children}
        {isHolding && (
          <span className="text-[10px] bg-black/20 rounded-full px-2 py-0.5 ml-1 animate-pulse">
            {Math.round(progress)}%
          </span>
        )}
      </div>
      
      {/* Background Progress Bar */}
      <div className="absolute inset-0 bg-black/5 z-0" />
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${progress}%` }}
        transition={{ type: "tween", ease: "linear", duration: 0.1 }}
        className="absolute inset-y-0 left-0 bg-white/30 z-[1]"
      />
      
      {/* Ripple/Glow effect when holding */}
      {isHolding && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-indigo-400/20 mix-blend-overlay animate-pulse"
        />
      )}
    </button>
  );
};

const DeliveryMap = ({ location }: { location?: { lat: number; lng: number } }) => {
  if (!location) return (
    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-2 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
      <Navigation size={32} className="animate-pulse" />
      <span className="text-xs font-medium">Aguardando sinal de GPS...</span>
    </div>
  );

  const center: [number, number] = [location.lat, location.lng];

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-gray-100 shadow-inner">
      <MapContainer 
        center={center} 
        zoom={15} 
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <ChangeView center={center} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={center}>
          <Popup>
            Motoboy está aqui!
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
};

const DeliveryProgress = ({ order }: { order: Order }) => {
  const steps = [
    { id: 'pending', label: 'Recebido', icon: Package, time: order.createdAt },
    { id: 'approved', label: 'Preparando', icon: Clock, time: order.approvedAt },
    { id: 'in_transit', label: 'Em Rota', icon: Bike, time: order.inTransitAt },
    { id: 'delivered', label: 'Entregue', icon: CheckCircle2, time: order.deliveredAt },
  ];

  const currentStepIndex = steps.findIndex(s => s.id === order.status);

  return (
    <div className="relative flex justify-between items-start w-full px-4">
      {/* Progress Line */}
      <div className="absolute top-5 left-8 right-8 h-0.5 bg-gray-100 -z-10">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${(currentStepIndex / (steps.length - 1)) * 100}%` }}
          className="h-full bg-emerald-500"
        />
      </div>

      {steps.map((step, index) => {
        const isCompleted = index <= currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const Icon = step.icon;

        return (
          <div key={step.id} className="flex flex-col items-center gap-2">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500",
              isCompleted ? "bg-emerald-500 text-white shadow-lg shadow-emerald-200" : "bg-white text-gray-300 border-2 border-gray-100",
              isCurrent && "ring-4 ring-emerald-50"
            )}>
              <Icon size={20} />
            </div>
            <div className="text-center">
              <p className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                isCompleted ? "text-emerald-600" : "text-gray-400"
              )}>
                {step.label}
              </p>
              {step.time && (
                <p className="text-[8px] font-bold text-gray-400 mt-0.5">
                  {step.time.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const NotificationToast = ({ notifications, remove }: { notifications: Notification[], remove: (id: string) => void }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none">
      <AnimatePresence>
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.9 }}
            className={cn(
              "pointer-events-auto p-4 rounded-xl shadow-lg border flex items-center gap-3 min-w-[300px]",
              n.type === 'success' ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
              n.type === 'warning' ? "bg-amber-50 border-amber-200 text-amber-800" :
              "bg-indigo-50 border-indigo-200 text-indigo-800"
            )}
          >
            <div className="flex-1">
              <p className="text-sm font-medium">{n.message}</p>
            </div>
            <button onClick={() => remove(n.id)} className="text-current opacity-50 hover:opacity-100">
              <Plus className="rotate-45" size={18} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const testConnection = async () => {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firestore connection: Client is offline.");
    } else {
      console.error("Firestore connection test failed:", error);
    }
  }
};

// --- Portal Navigation ---

const LandingPage = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  const portals = [
    {
      id: 'cliente',
      title: 'Área do Cliente',
      description: 'Faça pedidos, acompanhe entregas e veja seu histórico de compras.',
      icon: ShoppingCart,
      color: 'bg-emerald-500',
      path: '/cliente',
      gradient: 'from-emerald-400 to-emerald-600',
      tag: 'Público'
    },
    {
      id: 'farmacia',
      title: 'Painel da Farmácia',
      description: 'Gestão interna unificada: Farmacêuticos, Logística e Administração.',
      icon: Store,
      color: 'bg-indigo-600',
      path: '/farmacia',
      gradient: 'from-indigo-500 to-indigo-700',
      tag: 'Equipe'
    },
    {
      id: 'motoboy',
      title: 'App do Motoboy',
      description: 'Área exclusiva para entregadores gerenciarem suas rotas e entregas.',
      icon: Bike,
      color: 'bg-amber-500',
      path: '/motoboy',
      gradient: 'from-amber-400 to-amber-600',
      tag: 'Entregadores'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-5xl text-center space-y-12"
      >
        <div className="space-y-4">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-indigo-200 mb-6 rotate-3">
            <Bike size={40} className="text-white" />
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-gray-900 tracking-tight">
            Farma<span className="text-indigo-600">Entrega</span>
          </h1>
          <p className="text-lg text-gray-500 font-medium max-w-xl mx-auto uppercase tracking-[0.2em] italic">
            O sistema que move sua farmácia
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {portals
            .filter(portal => {
              if (!user || user.role === 'admin') return true;
              if (user.role === 'client') return portal.id === 'cliente';
              if (user.role === 'motoboy') return portal.id === 'motoboy';
              if (['pharmacist', 'logistics'].includes(user.role)) return portal.id === 'farmacia';
              return false;
            })
            .map((portal, idx) => (
              <motion.button
                key={portal.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => navigate(portal.path)}
                className="group relative bg-white p-8 rounded-[3rem] shadow-xl hover:shadow-2xl transition-all border border-gray-100 flex flex-col items-center text-center space-y-6 overflow-hidden w-full"
              >
                <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${portal.gradient} opacity-5 rounded-bl-full group-hover:scale-150 transition-transform duration-500`} />
                
                <div className={`w-16 h-16 ${portal.color} rounded-2xl flex items-center justify-center text-white shadow-lg shadow-${portal.color}/20 group-hover:rotate-6 transition-transform`}>
                  <portal.icon size={30} />
                </div>

                <div className="space-y-2 relative">
                  <div className="text-[10px] font-black uppercase text-gray-400 tracking-widest">{portal.tag}</div>
                  <h3 className="text-xl font-bold text-gray-900 tracking-tight">{portal.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed font-medium">
                    {portal.description}
                  </p>
                </div>

                <div className="w-full pt-2 relative">
                  <div className="bg-gray-50 p-3 rounded-2xl flex items-center justify-between group-hover:bg-indigo-50 transition-colors">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-indigo-600">Acessar</span>
                    <ArrowRight size={16} className="text-gray-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </motion.button>
            ))}
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => navigate('/demo')}
            className="inline-flex items-center gap-3 rounded-2xl border border-indigo-100 bg-white px-6 py-4 text-xs font-black uppercase tracking-widest text-indigo-600 shadow-lg shadow-indigo-100/50 transition-all hover:border-indigo-200 hover:bg-indigo-50"
          >
            <LayoutDashboard size={18} />
            Ver demonstracao sem login
          </button>
        </div>

        <div className="pt-8 opacity-40">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">
            FarmaEntrega &copy; 2026 • Tecnologia em Logística Farmacêutica
          </p>
        </div>
      </motion.div>
    </div>
  );
};

const loadingMessages = [
  'Conectando sua operação...',
  'Preparando sua experiência...',
  'Organizando pedidos e entregas...',
  'Carregando o FarmaEntrega...'
];

const LoadingScreen = () => {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMessageIndex(index => (index + 1) % loadingMessages.length);
    }, 900);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <div className="relative mb-8">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
          className="h-20 w-20 rounded-3xl border-4 border-indigo-100 border-t-indigo-600 bg-white shadow-2xl shadow-indigo-100"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Bike size={30} className="text-indigo-600" />
        </div>
      </div>

      <h1 className="mb-3 text-3xl font-black tracking-tight text-gray-900">
        Farma<span className="text-indigo-600">Entrega</span>
      </h1>

      <AnimatePresence mode="wait">
        <motion.p
          key={loadingMessages[messageIndex]}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="min-h-6 text-sm font-black uppercase tracking-widest text-indigo-600"
        >
          {loadingMessages[messageIndex]}
        </motion.p>
      </AnimatePresence>

      <div className="mt-8 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-indigo-100">
        <motion.div
          className="h-full rounded-full bg-indigo-600"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
};

const PortalLayout = ({ portal }: { portal: 'cliente' | 'farmacia' | 'motoboy' }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const handledInviteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(location.search);
    const inviteToken = params.get('motoboyInvite');
    if (!inviteToken) {
      handledInviteRef.current = null;
      return;
    }

    if (user.role === 'motoboy' && user.motoboyInviteToken === inviteToken) {
      window.history.replaceState(null, '', '/motoboy');
      setInviteStatus(null);
      navigate('/motoboy', { replace: true });
      return;
    }

    if (handledInviteRef.current === inviteToken) return;
    handledInviteRef.current = inviteToken;

    let cancelled = false;
    const applyInvite = async () => {
      setInviteStatus('Vinculando motoboy a farmacia...');
      try {
        const inviteSnap = await getDoc(doc(db, 'motoboyInvites', inviteToken));
        if (!inviteSnap.exists()) throw new Error('Convite nao encontrado.');
        const invite = inviteSnap.data() as { pharmacyId?: string; status?: string };
        if (!invite.pharmacyId || invite.status === 'revoked') throw new Error('Convite invalido.');

        await updateDoc(doc(db, 'users', user.uid), {
          role: 'motoboy',
          pharmacyId: invite.pharmacyId,
          status: 'available',
          motoboyInviteToken: inviteToken,
          updatedAt: serverTimestamp()
        });

        await setDoc(doc(db, 'motoboyInvites', inviteToken), {
          lastLinkedUserId: user.uid,
          lastLinkedAt: serverTimestamp()
        }, { merge: true });

        if (!cancelled) {
          setInviteStatus('Motoboy vinculado com sucesso. Redirecionando...');
          window.setTimeout(() => {
            if (cancelled) return;
            window.history.replaceState(null, '', '/motoboy');
            setInviteStatus(null);
            navigate('/motoboy', { replace: true });
          }, 600);
        }
      } catch (error) {
        console.error(error);
        handledInviteRef.current = null;
        if (!cancelled) setInviteStatus('Nao foi possivel vincular este convite. Peça um novo QR Code para a farmacia.');
      }
    };

    applyInvite();
    return () => {
      cancelled = true;
    };
  }, [user, location.search, navigate]);
  
  if (loading) return <LoadingScreen />;

  if (!user) {
    return <Login portal={portal} />;
  }

  if (inviteStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl max-w-md text-center space-y-4 border border-indigo-100">
          <Bike size={42} className="mx-auto text-indigo-600" />
          <h2 className="text-2xl font-black text-gray-900">Vinculo do Motoboy</h2>
          <p className="text-sm font-bold text-gray-500">{inviteStatus}</p>
        </div>
      </div>
    );
  }

  const role = user.role;
  const isAdmin = role === 'admin';

  // Lógica de Permissão por Portal
  const hasAccess = () => {
    if (isAdmin) return true; // Admin entra em tudo
    
    if (portal === 'farmacia') {
      return ['pharmacist', 'logistics'].includes(role);
    }
    
    if (portal === 'motoboy') {
      return role === 'motoboy';
    }
    
    if (portal === 'cliente') {
      return role === 'client';
    }
    
    return false;
  };

  if (!hasAccess()) {
    const correctPath = role === 'client' ? '/cliente' : 
                       role === 'motoboy' ? '/motoboy' : 
                       ['pharmacist', 'logistics'].includes(role) ? '/farmacia' : '/';

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl max-w-md text-center space-y-6 border border-red-100">
           <div className="w-20 h-20 bg-red-50 text-red-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-inner">
             <Shield size={40} className="animate-pulse" />
           </div>
           <div className="space-y-2">
             <h2 className="text-3xl font-black text-gray-900 italic tracking-tight">Acesso Restrito</h2>
             <p className="text-gray-400 text-xs font-black uppercase tracking-widest">Protocolo de Segurança Ativo</p>
           </div>
           <p className="text-gray-500 font-medium leading-relaxed">
             Você está logado como <b className="text-gray-900">{role}</b> e não tem permissão para acessar esta área.
           </p>
           <div className="pt-4 space-y-3">
             <button 
               onClick={() => window.location.href = correctPath} 
               className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
             >
               Ir para meu Painel Correto
             </button>
             <button 
               onClick={() => window.location.href = '/'} 
               className="w-full text-gray-400 py-2 text-[10px] font-black uppercase tracking-widest hover:text-gray-600"
             >
               Voltar ao Início
             </button>
           </div>
        </div>
      </div>
    );
  }

  if (portal === 'motoboy' && role !== 'motoboy' && role !== 'admin') {
     return <Navigate to="/farmacia" replace />;
  }

  return <Dashboard portal={portal} />;
};

// --- Views ---
// --- Componentes Auxiliares ---

const PharmacistView = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);

  const isOrderRecent = (order: Order) => {
    if (!order.createdAt || order.status !== 'pending') return false;
    try {
      const orderTime = order.createdAt.toMillis ? order.createdAt.toMillis() : (order.createdAt.seconds * 1000);
      return (Date.now() - orderTime) < 300000; // 5 minutos
    } catch { return false; }
  };

  const [isAdding, setIsAdding] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPayment, setFilterPayment] = useState<string>('all');
  const [filterDeliveryType, setFilterDeliveryType] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editData, setEditData] = useState({ 
    items: '', 
    change: 0, 
    totalValue: 0,
    customerName: '',
    customerAddress: '',
    customerPhone: '',
    deliveryType: 'normal' as DeliveryType
  });
  const [newOrder, setNewOrder] = useState({
    customerName: '',
    customerAddress: '',
    customerPhone: '',
    items: '',
    paymentMethod: 'dinheiro' as PaymentMethod,
    deliveryType: 'normal' as DeliveryType,
    totalValue: 0,
    change: 0
  });

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'orders'), where('pharmacyId', '==', getPharmacyId(user)));
    const path = 'orders';
    return onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setOrders(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
  }, [user]);

  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const path = 'orders';
    const orderCode = Math.floor(1000 + Math.random() * 9000).toString();
    // Mock customer location around a central point (e.g., Sao Paulo)
    const mockLat = -23.5505 + (Math.random() - 0.5) * 0.05;
    const mockLng = -46.6333 + (Math.random() - 0.5) * 0.05;
    
    try {
      const totalValue = Number(newOrder.totalValue || 0);
      const change = newOrder.paymentMethod === 'dinheiro' ? Number(newOrder.change || 0) : 0;
      if (change > 0 && change <= totalValue) {
        alert('O valor para troco deve ser maior que o valor do pedido.');
        return;
      }

      await addDoc(collection(db, path), {
        ...newOrder,
        totalValue,
        change,
        orderCode,
        status: 'pending',
        pharmacistId: user?.uid,
        pharmacyId: getPharmacyId(user),
        customerLocation: { lat: mockLat, lng: mockLng },
        createdAt: serverTimestamp()
      });
      setIsAdding(false);
      setNewOrder({ customerName: '', customerAddress: '', customerPhone: '', items: '', paymentMethod: 'dinheiro', deliveryType: 'normal', totalValue: 0, change: 0 });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const confirmCancelOrder = async () => {
    if (!cancellingOrderId || !cancelReason.trim()) return;
    
    const path = `orders/${cancellingOrderId}`;
    try {
      const orderDoc = await getDoc(doc(db, 'orders', cancellingOrderId));
      const orderData = orderDoc.data() as Order;

      await updateDoc(doc(db, 'orders', cancellingOrderId), {
        status: 'cancelled',
        cancellationReason: cancelReason,
        updatedAt: serverTimestamp()
      });

      // Notificar via WhatsApp
      const message = getWhatsAppMessage({ ...orderData, status: 'cancelled', cancellationReason: cancelReason } as Order);
      window.open(message, '_blank');

      setCancellingOrderId(null);
      setCancelReason('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const updateStatus = async (id: string, newStatus: OrderStatus) => {
    const path = `orders/${id}`;
    try {
      const orderDoc = await getDoc(doc(db, 'orders', id));
      const orderData = orderDoc.data() as Order;
      
      const updateData: any = {
        status: newStatus,
        updatedAt: serverTimestamp()
      };
      
      if (newStatus === 'approved') updateData.approvedAt = serverTimestamp();
      if (newStatus === 'ready') updateData.readyAt = serverTimestamp(); // Opcional se quiser trackear hora que ficou pronto

      await updateDoc(doc(db, 'orders', id), updateData);

      // Notificar cliente via WhatsApp sobre a mudança
      const message = getWhatsAppMessage({ ...orderData, status: newStatus } as Order);
      window.open(message, '_blank');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const approveOrder = (id: string) => updateStatus(id, 'approved');

  const deleteOrder = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este pedido?')) return;
    const path = `orders/${id}`;
    try {
      await deleteDoc(doc(db, 'orders', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleUpdateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    const path = `orders/${editingOrder.id}`;
    try {
      const totalValue = Number(editData.totalValue || 0);
      const change = editingOrder.paymentMethod === 'dinheiro' ? Number(editData.change || 0) : 0;
      if (change > 0 && change <= totalValue) {
        alert('O valor para troco deve ser maior que o valor do pedido.');
        return;
      }

      await updateDoc(doc(db, 'orders', editingOrder.id), {
        items: editData.items,
        change,
        totalValue,
        customerName: editData.customerName,
        customerAddress: editData.customerAddress,
        customerPhone: editData.customerPhone,
        deliveryType: editData.deliveryType,
        updatedAt: serverTimestamp()
      });
      setEditingOrder(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchStatus = filterStatus === 'all' ? true : order.status === filterStatus;
    const matchPayment = filterPayment === 'all' ? true : order.paymentMethod === filterPayment;
    const matchType = filterDeliveryType === 'all' ? true : order.deliveryType === filterDeliveryType;
    
    let matchDate = true;
    if (filterStartDate) {
      const start = new Date(filterStartDate);
      matchDate = matchDate && (order.createdAt?.toDate?.() ?? new Date(0)) >= start;
    }
    if (filterEndDate) {
      const end = new Date(filterEndDate);
      end.setHours(23, 59, 59, 999);
      matchDate = matchDate && (order.createdAt?.toDate?.() ?? new Date()) <= end;
    }

    return matchStatus && matchPayment && matchType && matchDate;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Painel Operacional</h2>
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-indigo-600 text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 font-bold whitespace-nowrap"
        >
          <Plus size={20} /> Novo Pedido
        </button>
      </div>

      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Status</label>
          <select 
            className="p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 outline-none"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">Todos os Status</option>
            <option value="pending">Aguardando Aprovação</option>
            <option value="approved">Em Preparação</option>
            <option value="ready">Pedido Pronto</option>
            <option value="in_transit">Em Rota</option>
            <option value="delivered">Entregues</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Pagamento</label>
          <select 
            className="p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 outline-none"
            value={filterPayment}
            onChange={(e) => setFilterPayment(e.target.value)}
          >
            <option value="all">Todos Pagamentos</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="cartao">Cartão</option>
            <option value="pix">PIX</option>
            <option value="convenio">Convênio / deixar na conta</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Tipo</label>
          <select 
            className="p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 outline-none"
            value={filterDeliveryType}
            onChange={(e) => setFilterDeliveryType(e.target.value)}
          >
            <option value="all">Todos Tipos</option>
            <option value="normal">Normal</option>
            <option value="urgente">Urgente</option>
            <option value="controlado">Controlado</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Início</label>
          <input 
            type="date"
            className="p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 outline-none"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fim</label>
          <input 
            type="date"
            className="p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 outline-none"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
          />
        </div>
        <button 
          onClick={() => {
            setFilterStatus('all');
            setFilterPayment('all');
            setFilterDeliveryType('all');
            setFilterStartDate('');
            setFilterEndDate('');
          }}
          className="p-3 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all font-bold text-sm"
        >
          Limpar Filtros
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white p-6 rounded-xl shadow-sm border border-gray-100"
          >
            <form onSubmit={handleAddOrder} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input 
                placeholder="Nome do Cliente"
                className="p-2 border rounded-lg"
                value={newOrder.customerName}
                onChange={e => setNewOrder({...newOrder, customerName: e.target.value})}
                required
              />
              <input 
                placeholder="Telefone"
                className="p-2 border rounded-lg"
                value={newOrder.customerPhone}
                onChange={e => setNewOrder({...newOrder, customerPhone: e.target.value})}
                required
              />
              <input 
                placeholder="Endereço Completo"
                className="p-2 border rounded-lg md:col-span-2"
                value={newOrder.customerAddress}
                onChange={e => setNewOrder({...newOrder, customerAddress: e.target.value})}
                required
              />
              <textarea 
                placeholder="Itens do Pedido"
                className="p-2 border rounded-lg md:col-span-2"
                value={newOrder.items}
                onChange={e => setNewOrder({...newOrder, items: e.target.value})}
                required
              />
              <div className="md:col-span-1 space-y-2">
                <label className="text-sm font-medium text-gray-700">Valor do Pedido (R$)</label>
                <input 
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  className="w-full p-2 border rounded-lg"
                  value={newOrder.totalValue || ''}
                  onChange={e => setNewOrder({...newOrder, totalValue: parseFloat(e.target.value)})}
                  required
                />
              </div>
              <div className="md:col-span-1 space-y-2">
                <label className="text-sm font-medium text-gray-700">Troco</label>
                {newOrder.paymentMethod === 'dinheiro' ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setNewOrder({...newOrder, change: 0})}
                        className={cn(
                          "flex-1 p-2 rounded-lg border text-sm font-bold",
                          !newOrder.change ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-200"
                        )}
                      >
                        Não
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewOrder({...newOrder, change: newOrder.change || Math.ceil(Number(newOrder.totalValue || 0) / 10) * 10})}
                        className={cn(
                          "flex-1 p-2 rounded-lg border text-sm font-bold",
                          newOrder.change ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-500 border-gray-200"
                        )}
                      >
                        Sim
                      </button>
                    </div>
                    {Boolean(newOrder.change) && (
                      <>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Troco para quanto?"
                          className="w-full p-2 border rounded-lg"
                          value={newOrder.change || ''}
                          onChange={e => setNewOrder({...newOrder, change: parseFloat(e.target.value) || 0})}
                        />
                        <p className="text-xs font-bold text-emerald-600">
                          Levar troco de R$ {money(Math.max(Number(newOrder.change || 0) - Number(newOrder.totalValue || 0), 0))}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-gray-50 text-xs font-bold text-gray-400">Não se aplica</div>
                )}
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-sm font-medium text-gray-700">Forma de Pagamento</label>
                <div className="flex gap-4">
                  {paymentMethods.map((method) => (
                    <label key={method} className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="paymentMethod" 
                        value={method}
                        checked={newOrder.paymentMethod === method}
                        onChange={() => setNewOrder({...newOrder, paymentMethod: method, change: method === 'dinheiro' ? newOrder.change : 0})}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm">{paymentMethodLabels[method]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-sm font-medium text-gray-700">Tipo de Entrega</label>
                <div className="flex gap-4">
                  {(['normal', 'urgente', 'controlado'] as const).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="radio" 
                        name="deliveryType" 
                        value={type}
                        checked={newOrder.deliveryType === type}
                        onChange={() => setNewOrder({...newOrder, deliveryType: type})}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className={cn(
                        "text-sm capitalize px-2 py-0.5 rounded",
                        type === 'urgente' ? "bg-red-50 text-red-600 font-bold" :
                        type === 'controlado' ? "bg-amber-50 text-amber-600 font-bold" :
                        "text-gray-600"
                      )}>
                        {type}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-2 text-gray-600">Cancelar</button>
                <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg">Salvar Pedido</button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-100"
            >
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight">Editar Pedido</h3>
                  <p className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg mt-1 inline-block">#{editingOrder.orderCode}</p>
                </div>
                <button 
                  onClick={() => setEditingOrder(null)}
                  className="w-10 h-10 bg-gray-50 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 transition-all"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <form onSubmit={handleUpdateOrder} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome do Cliente</label>
                    <input 
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                      value={editData.customerName}
                      onChange={e => setEditData({...editData, customerName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Telefone</label>
                    <input 
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                      value={editData.customerPhone}
                      onChange={e => setEditData({...editData, customerPhone: e.target.value})}
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Endereço de Entrega</label>
                    <input 
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                      value={editData.customerAddress}
                      onChange={e => setEditData({...editData, customerAddress: e.target.value})}
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Itens do Pedido</label>
                    <textarea 
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium min-h-[100px]"
                      value={editData.items}
                      onChange={e => setEditData({...editData, items: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Valor Total (R$)</label>
                    <input 
                      type="number"
                      step="0.01"
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-black"
                      value={editData.totalValue}
                      onChange={e => setEditData({...editData, totalValue: parseFloat(e.target.value)})}
                    />
                  </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Troco</label>
                    {editingOrder?.paymentMethod === 'dinheiro' ? (
                      <div className="space-y-2">
                        <input
                          type="number"
                          step="0.01"
                          className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-black text-emerald-600"
                          value={editData.change}
                          onChange={e => setEditData({...editData, change: parseFloat(e.target.value) || 0})}
                          placeholder="Troco para quanto?"
                        />
                        <p className="text-xs font-bold text-emerald-600">
                          {editData.change ? `Levar troco de R$ ${money(Math.max(Number(editData.change || 0) - Number(editData.totalValue || 0), 0))}` : 'Sem troco'}
                        </p>
                      </div>
                    ) : (
                      <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-gray-400">Não se aplica</div>
                    )}
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Tipo de Entrega</label>
                    <div className="flex gap-4 p-2">
                       {(['normal', 'urgente', 'controlado'] as const).map((type) => (
                        <label key={type} className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="radio" 
                            name="editDeliveryType" 
                            value={type}
                            checked={editData.deliveryType === type}
                            onChange={() => setEditData({...editData, deliveryType: type})}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className={cn(
                            "text-xs font-bold capitalize px-3 py-1 rounded-full",
                            type === 'urgente' ? "bg-red-50 text-red-600" :
                            type === 'controlado' ? "bg-amber-50 text-amber-600" :
                            "bg-gray-100 text-gray-600"
                          )}>
                            {type}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  type="submit"
                  className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all text-lg"
                >
                  Salvar Alterações
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-bottom border-gray-100">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cód</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cliente</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Itens</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Valor</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pagamento</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredOrders.map(order => (
              <tr 
                key={order.id} 
                className={cn(
                  "hover:bg-gray-50 transition-colors",
                  isOrderRecent(order) && "animate-pulse-red"
                )}
              >
                <td className="px-6 py-4 text-sm font-mono text-indigo-600">#{order.orderCode}</td>
                <td className="px-6 py-4">
                  <div className="font-medium text-gray-900">{order.customerName}</div>
                  <div className="text-sm text-gray-500">{order.customerAddress}</div>
                  {order.deliveryType && order.deliveryType !== 'normal' && (
                    <span className={cn(
                      "text-[10px] font-black uppercase px-1.5 py-0.5 rounded mt-1 inline-block",
                      order.deliveryType === 'urgente' ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
                    )}>
                      {order.deliveryType}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600">{order.items}</td>
                <td className="px-6 py-4">
                  <div className="text-sm font-bold text-gray-900">R$ {order.totalValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                  {getChangeDue(order) ? (
                    <div className="text-[10px] font-bold text-emerald-600">{getChangeLabel(order)}</div>
                  ) : (
                    <div className="text-[10px] font-bold text-gray-300">Sem troco</div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs font-medium bg-gray-100 px-2 py-1 rounded capitalize">
                    {order.paymentMethod ? paymentMethodLabels[order.paymentMethod] : 'N/A'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <StatusBadge status={order.status} />
                  {order.status === 'cancelled' && order.cancellationReason && (
                    <div className="mt-1 p-2 bg-red-50 rounded-lg border border-red-100">
                      <p className="text-[9px] font-black text-red-600 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                        <AlertTriangle size={10} /> Motivo do Cancelamento
                      </p>
                      <p className="text-[10px] font-medium text-red-800 leading-tight italic">"{order.cancellationReason}"</p>
                    </div>
                  )}
                  <div className="mt-1 space-y-0.5">
                    <div className="text-[10px] font-medium text-gray-400 flex items-center gap-1">
                      <Clock size={10} /> {order.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                    </div>
                    {order.deliveredAt && (
                      <div className="text-[10px] font-medium text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 size={10} /> {order.deliveredAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                  <button 
                    onClick={() => {
                      setEditingOrder(order);
                      setEditData({ 
                        items: order.items, 
                        change: order.change || 0, 
                        totalValue: order.totalValue || 0,
                        customerName: order.customerName,
                        customerAddress: order.customerAddress,
                        customerPhone: order.customerPhone,
                        deliveryType: order.deliveryType || 'normal'
                      });
                    }}
                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                    title="Editar Pedido"
                  >
                    <Edit size={18} />
                  </button>
                  {user?.role === 'admin' && false && (
                    <button 
                      onClick={() => deleteOrder(order.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Excluir Pedido"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                  {order.status !== 'delivered' && order.status !== 'cancelled' && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setCancellingOrderId(order.id);
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-all shadow-sm border border-red-50 relative z-20"
                      title="Cancelar Pedido"
                    >
                      <XCircle size={20} />
                    </button>
                  )}
                  <a 
                    href={getWhatsAppMessage(order)}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                    title="Notificar via WhatsApp"
                  >
                    <MessageSquare size={18} />
                  </a>
                  {order.status === 'pending' && (
                    <button 
                      onClick={() => approveOrder(order.id)}
                      className="bg-indigo-600 text-white px-3 py-1 rounded-full font-bold text-xs hover:bg-indigo-700 transition-all shadow-sm"
                    >
                      Aprovar
                    </button>
                  )}
                  {order.status === 'approved' && (
                    <button 
                      onClick={() => updateStatus(order.id, 'ready')}
                      className="bg-amber-500 text-white px-3 py-1 rounded-full font-bold text-xs hover:bg-amber-600 transition-all shadow-sm"
                    >
                      Pronto
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {cancellingOrderId && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end md:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl space-y-6"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <XCircle size={32} />
                </div>
                <h3 className="text-2xl font-black text-gray-900 italic tracking-tight">Cancelar Pedido</h3>
                <p className="text-gray-500 font-medium text-sm">Esta ação não pode ser desfeita. Por favor, justifique o cancelamento.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">Motivo do Cancelamento</label>
                <textarea 
                  className="w-full bg-gray-50 border-2 border-gray-100 p-4 rounded-2xl font-bold focus:ring-4 focus:ring-red-50 focus:border-red-200 outline-none transition-all h-32 resize-none"
                  placeholder="Ex: Falta de estoque de um dos itens..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => { setCancellingOrderId(null); setCancelReason(''); }}
                  className="bg-gray-100 text-gray-600 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-all"
                >
                  Voltar
                </button>
                <button 
                  onClick={confirmCancelOrder}
                  disabled={!cancelReason.trim()}
                  className="bg-red-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-red-100 hover:bg-red-700 disabled:opacity-50 transition-all"
                >
                  Confirmar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// CSS adicional para animações
const GlobalStyles = () => (
  <style>{`
    @keyframes pulse-red {
      0% { background-color: rgba(254, 226, 226, 0.2); }
      50% { background-color: rgba(254, 226, 226, 0.8); }
      100% { background-color: rgba(254, 226, 226, 0.2); }
    }
    .animate-pulse-red {
      animation: pulse-red 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
  `}</style>
);

const LogisticsView = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [motoboys, setMotoboys] = useState<AppUser[]>([]);
  const [isAddingMotoboy, setIsAddingMotoboy] = useState(false);
  const [newMotoboy, setNewMotoboy] = useState({ name: '', email: '', phone: '' });
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterMotoboy, setFilterMotoboy] = useState<string>('all');
  const [filterPayment, setFilterPayment] = useState<string>('all');
  const [filterDeliveryType, setFilterDeliveryType] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [selectedOrderQR, setSelectedOrderQR] = useState<Order | null>(null);
  const [motoboyInviteUrl, setMotoboyInviteUrl] = useState<string | null>(null);
  const [isCreatingMotoboyInvite, setIsCreatingMotoboyInvite] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editData, setEditData] = useState({ 
    items: '', 
    change: 0, 
    totalValue: 0,
    customerName: '',
    customerAddress: '',
    customerPhone: ''
  });

  useEffect(() => {
    if (!user) return;
    const pharmacyId = getPharmacyId(user);
    const q = query(collection(db, 'orders'), where('pharmacyId', '==', pharmacyId));
    const unsubOrders = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setOrders(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });

    const mq = query(collection(db, 'users'), where('role', '==', 'motoboy'), where('pharmacyId', '==', pharmacyId));
    const unsubMotoboys = onSnapshot(mq, (snapshot) => {
      setMotoboys(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => { unsubOrders(); unsubMotoboys(); };
  }, [user]);

  const assignMotoboy = async (orderId: string, motoboy: AppUser | null) => {
    const path = `orders/${orderId}`;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        motoboyId: motoboy?.uid || null,
        motoboyName: motoboy?.name || null,
        status: motoboy ? 'in_transit' : 'ready', // Se atribuiu motoboy, já vai pra rota
        approvedAt: motoboy ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const deleteOrder = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este pedido?')) return;
    const path = `orders/${id}`;
    try {
      await deleteDoc(doc(db, 'orders', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleUpdateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    const path = `orders/${editingOrder.id}`;
    try {
      await updateDoc(doc(db, 'orders', editingOrder.id), {
        items: editData.items,
        change: editData.change,
        totalValue: editData.totalValue,
        customerName: editData.customerName,
        customerAddress: editData.customerAddress,
        customerPhone: editData.customerPhone,
        deliveryType: editData.deliveryType,
        updatedAt: serverTimestamp()
      });
      setEditingOrder(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const motoboyList = motoboys;

  const createMotoboyInvite = async () => {
    if (!user) return;
    setIsCreatingMotoboyInvite(true);
    const token = `${getPharmacyId(user)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const path = `motoboyInvites/${token}`;
    try {
      await setDoc(doc(db, 'motoboyInvites', token), {
        token,
        pharmacyId: getPharmacyId(user),
        createdBy: user.uid,
        status: 'active',
        createdAt: serverTimestamp()
      });
      setMotoboyInviteUrl(`${window.location.origin}/motoboy?motoboyInvite=${encodeURIComponent(token)}`);
    } catch (error) {
      console.error('Erro ao criar convite do motoboy:', { error, path });
      alert('Nao foi possivel gerar o QR do motoboy. Atualize o app e tente novamente.');
    } finally {
      setIsCreatingMotoboyInvite(false);
    }
  };

  const handleRegisterMotoboy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(newMotoboy.email)) {
      alert('Por favor, insira um e-mail válido para o motoboy.');
      return;
    }
    const tempUid = `mb_${Date.now()}`;
    const path = `users/${tempUid}`;
    try {
      await setDoc(doc(db, 'users', tempUid), {
        uid: tempUid,
        name: newMotoboy.name,
        email: newMotoboy.email,
        phone: newMotoboy.phone,
        role: 'motoboy',
        status: 'available',
        pharmacyId: getPharmacyId(user)
      }, { merge: true });
      setIsAddingMotoboy(false);
      setNewMotoboy({ name: '', email: '', phone: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const unlinkMotoboy = async (motoboy: AppUser) => {
    if (!user || motoboy.uid === user.uid) return;

    const confirmed = window.confirm(
      `Desvincular ${motoboy.name} desta farmacia? Ele deixara de aparecer como motoboy ativo e nao tera mais acesso ao painel do motoboy desta farmacia.`
    );
    if (!confirmed) return;

    const path = `users/${motoboy.uid}`;
    try {
      await updateDoc(doc(db, 'users', motoboy.uid), {
        role: 'client',
        pharmacyId: null,
        status: 'inactive',
        motoboyInviteToken: null,
        unlinkedAt: serverTimestamp(),
        unlinkedBy: user.uid,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const clearCompletedOrders = async () => {
    if (!window.confirm('Deseja excluir permanentemente todos os pedidos concluídos?')) return;
    const deliveredOrders = orders.filter(o => o.status === 'delivered');
    if (deliveredOrders.length === 0) {
      alert('Não há pedidos concluídos para excluir.');
      return;
    }
    
    try {
      const promises = deliveredOrders.map(o => deleteDoc(doc(db, 'orders', o.id)));
      await Promise.all(promises);
      alert(`${deliveredOrders.length} pedidos excluídos com sucesso.`);
    } catch (error) {
       handleFirestoreError(error, OperationType.DELETE, 'orders/bulk');
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchStatus = filterStatus === 'all' ? true : order.status === filterStatus;
    const matchMotoboy = filterMotoboy === 'all' ? true : order.motoboyId === filterMotoboy;
    const matchPayment = filterPayment === 'all' ? true : order.paymentMethod === filterPayment;
    const matchType = filterDeliveryType === 'all' ? true : order.deliveryType === filterDeliveryType;
    
    let matchDate = true;
    if (filterStartDate) {
      const start = new Date(filterStartDate);
      matchDate = matchDate && (order.createdAt?.toDate?.() ?? new Date(0)) >= start;
    }
    if (filterEndDate) {
      const end = new Date(filterEndDate);
      end.setHours(23, 59, 59, 999);
      matchDate = matchDate && (order.createdAt?.toDate?.() ?? new Date()) <= end;
    }

    return matchStatus && matchMotoboy && matchPayment && matchType && matchDate;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Distribuição Logística</h2>
          {user?.role === 'admin' && (
             <button 
              onClick={clearCompletedOrders}
              className="mt-1 text-[9px] font-black uppercase text-red-500 hover:text-red-700 transition-colors flex items-center gap-1"
            >
              <Trash2 size={10} /> Limpar Concluídos
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={createMotoboyInvite}
            disabled={isCreatingMotoboyInvite}
            className="bg-white text-indigo-600 px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-50 transition-all border border-indigo-100 font-bold text-xs disabled:opacity-60"
          >
            <QrCode size={16} /> {isCreatingMotoboyInvite ? 'Gerando...' : 'QR Motoboy'}
          </button>
          <button 
            onClick={() => setIsAddingMotoboy(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 font-bold text-xs"
          >
            <Plus size={16} /> Novo Motoboy
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Status</label>
          <div className="relative">
            <select 
              className="appearance-none p-2 pr-8 border border-gray-100 rounded-xl text-xs font-bold bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="pending">Aguardando Aprovação</option>
              <option value="approved">Em Preparação</option>
              <option value="ready">Pedido Pronto</option>
              <option value="in_transit">Em Rota</option>
              <option value="delivered">Entregues</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Motoboy</label>
          <div className="relative">
            <select 
              className="appearance-none p-2 pr-8 border border-gray-100 rounded-xl text-xs font-bold bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer max-w-[120px]"
              value={filterMotoboy}
              onChange={(e) => setFilterMotoboy(e.target.value)}
            >
              <option value="all">Todos</option>
              {motoboys.map(mb => (
                <option key={mb.uid} value={mb.uid}>{mb.name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Pagto</label>
          <div className="relative">
            <select 
              className="appearance-none p-2 pr-8 border border-gray-100 rounded-xl text-xs font-bold bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="cartao">Cartão</option>
              <option value="pix">PIX</option>
              <option value="convenio">Convênio</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Datas</label>
          <div className="flex gap-1">
            <input 
              type="date"
              className="p-2 border border-gray-100 rounded-xl text-[10px] font-bold bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
            />
            <input 
              type="date"
              className="p-2 border border-gray-100 rounded-xl text-[10px] font-bold bg-gray-50 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
            />
          </div>
        </div>
        <button 
          onClick={() => {
            setFilterStatus('all');
            setFilterMotoboy('all');
            setFilterPayment('all');
            setFilterDeliveryType('all');
            setFilterStartDate('');
            setFilterEndDate('');
          }}
          className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all font-bold text-[10px] uppercase underline decoration-2 underline-offset-4"
        >
          Limpar
        </button>
      </div>

      <AnimatePresence>
        {motoboyInviteUrl && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center space-y-6"
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold text-gray-900">QR de Vinculo do Motoboy</h3>
                <button onClick={() => setMotoboyInviteUrl(null)} className="text-gray-400 hover:text-gray-600">
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-gray-200 inline-block">
                <QRCodeCanvas
                  value={motoboyInviteUrl}
                  size={220}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <p className="text-sm font-bold text-gray-500">
                O motoboy deve abrir este QR, entrar com Google ou e-mail e será vinculado automaticamente a esta farmácia.
              </p>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(motoboyInviteUrl);
                  alert('Link do motoboy copiado.');
                }}
                className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
              >
                Copiar Link
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAddingMotoboy && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100 space-y-6"
          >
            <div className="flex items-center gap-3 text-indigo-600">
              <Plus size={24} />
              <h3 className="text-xl font-bold text-gray-900">Novo Motoboy</h3>
            </div>
            <form onSubmit={handleRegisterMotoboy} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome Completo</label>
                <input 
                  placeholder="Ex: João Silva"
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newMotoboy.name}
                  onChange={e => setNewMotoboy({...newMotoboy, name: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">E-mail</label>
                <input 
                  placeholder="joao@farma.com"
                  type="email"
                  className={cn(
                    "w-full p-4 bg-gray-50 border rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all",
                    newMotoboy.email && !isValidEmail(newMotoboy.email) ? "border-red-300 focus:ring-red-500" : "border-gray-100"
                  )}
                  value={newMotoboy.email}
                  onChange={e => setNewMotoboy({...newMotoboy, email: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Telefone</label>
                <input 
                  placeholder="+55 (11) 99999-9999"
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newMotoboy.phone}
                  onChange={e => setNewMotoboy({...newMotoboy, phone: e.target.value})}
                  required
                />
              </div>
              <div className="md:col-span-3 flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsAddingMotoboy(false)} className="px-6 py-3 text-gray-400 font-bold hover:text-gray-600 transition-colors">Cancelar</button>
                <button type="submit" className="bg-gray-900 text-white px-8 py-3 rounded-2xl font-bold shadow-lg hover:bg-black transition-all">Cadastrar Motoboy</button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
      

      <div className="space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Clock size={20} className="text-indigo-600" /> Gestão de Pedidos
            </h3>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              {filteredOrders.length} Pedidos Encontrados
            </span>
          </div>
          
          <div className="bg-white rounded-[2rem] shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200">
                    <th className="px-5 py-4 text-[11px] font-black text-gray-400 uppercase tracking-widest">Cód</th>
                    <th className="px-5 py-4 text-[11px] font-black text-gray-400 uppercase tracking-widest">Pedido / Endereço</th>
                    <th className="px-5 py-4 text-[11px] font-black text-gray-400 uppercase tracking-widest text-center">Valor / Troco</th>
                    <th className="px-5 py-4 text-[11px] font-black text-gray-400 uppercase tracking-widest text-center">Pagto</th>
                    <th className="px-5 py-4 text-[11px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                    <th className="px-5 py-4 text-[11px] font-black text-gray-400 uppercase tracking-widest">Motoboy</th>
                    <th className="px-5 py-4 text-[11px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredOrders.map(order => (
                    <tr key={order.id} className="group hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                      <td className="px-5 py-4">
                        <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                          #{order.orderCode}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-bold text-gray-900 text-sm leading-tight">{order.customerName}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[200px] flex items-center gap-1.5 mt-1">
                          <MapPin size={12} className="flex-shrink-0" /> {order.customerAddress}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <div className="text-sm font-black text-gray-900">
                          R$ {order.totalValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </div>
                        {getChangeDue(order) ? (
                          <div className="text-[11px] font-bold text-emerald-600 mt-0.5">
                            {getChangeLabel(order)}
                          </div>
                        ) : (
                          <div className="text-[11px] font-bold text-gray-300 mt-0.5 whitespace-nowrap">Sem troco</div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="text-xs font-black uppercase bg-gray-100 text-gray-600 px-2 py-1 rounded-md border border-gray-200">
                          {order.paymentMethod ? paymentMethodLabels[order.paymentMethod] : 'N/D'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <div className={cn(
                            "w-2 h-2 rounded-full flex-shrink-0",
                            order.motoboyId ? (motoboyList.find(m => m.uid === order.motoboyId)?.status === 'available' ? "bg-emerald-500" : "bg-amber-500") : "bg-gray-200"
                          )} />
                          <div className="text-sm font-bold text-gray-700 truncate max-w-[100px]">
                            {order.motoboyName || 'Não Atribuído'}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <div className="relative group/select">
                            <select 
                              className="appearance-none bg-white border border-gray-100 text-[11px] font-bold py-2 pl-3 pr-9 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer shadow-sm hover:border-indigo-200 transition-all"
                              value={order.motoboyId || ""}
                              onChange={(e) => {
                                if (e.target.value === 'remove') {
                                  assignMotoboy(order.id, null);
                                } else {
                                  const mb = motoboyList.find(m => m.uid === e.target.value);
                                  if (mb) assignMotoboy(order.id, mb);
                                }
                              }}
                            >
                              <option value="" disabled>{order.motoboyId ? 'Alterar' : 'Atribuir'}</option>
                              {order.motoboyId && <option value="remove">× Remover</option>}
                              {motoboyList.map(mb => (
                                <option key={mb.uid} value={mb.uid}>
                                  {mb.name} {mb.uid === user?.uid ? '(Você)' : ''}
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                          <button 
                            onClick={() => setSelectedOrderQR(order)}
                            className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                            title="QR Code"
                          >
                            <QrCode size={16} />
                          </button>
                          <button 
                            onClick={() => {
                              setEditingOrder(order);
                              setEditData({ 
                                items: order.items, 
                                change: order.change || 0, 
                                totalValue: order.totalValue || 0,
                                customerName: order.customerName,
                                customerAddress: order.customerAddress,
                                customerPhone: order.customerPhone
                              });
                            }}
                            className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                            title="Editar"
                          >
                            <Edit size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-5 mt-4">
          <div className="flex items-center justify-between px-2">
            <h3 className="font-black text-gray-900 flex items-center gap-2 text-lg tracking-tight">
              <Bike size={24} className="text-indigo-600" /> Motoboys Ativos
            </h3>
            <span className="text-xs font-black text-gray-400 uppercase tracking-widest bg-gray-50 px-3 py-1 rounded-full border border-gray-100">
              {motoboyList.length} Profissionais
            </span>
          </div>
          
          {motoboyList.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center shadow-sm">
              <p className="text-sm font-black uppercase tracking-widest text-gray-400">Nenhum motoboy vinculado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {motoboyList.map(mb => {
                const displayName = mb.name?.trim() || mb.email || 'Motoboy';
                return (
                  <div key={mb.uid} className="flex min-w-0 items-start gap-4 rounded-3xl border border-gray-100 bg-white p-5 shadow-xl shadow-gray-200/40 transition-all hover:border-indigo-100 hover:bg-indigo-50/10">
                    <div className="relative shrink-0">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-100/50 bg-indigo-50 text-xl font-black text-indigo-600 shadow-sm">
                        {displayName[0].toUpperCase()}
                      </div>
                      <div className={cn(
                        "absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-4 border-white shadow-md",
                        mb.status === 'available' ? "bg-emerald-500" : "bg-amber-500"
                      )} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-black leading-snug text-gray-900">
                        {displayName}
                      </div>
                      <div className="mt-2 flex min-w-0 items-start gap-1 text-[11px] font-bold uppercase leading-snug text-gray-400">
                        <Phone size={10} className="shrink-0 text-indigo-300" />
                        <span className="break-all">{mb.phone || mb.email || 'Sem contato'}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-1">
                      <div className={cn(
                        "rounded-lg border px-2 py-1 text-[10px] font-black uppercase shadow-sm",
                        mb.status === 'available' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100"
                      )}>
                        {mb.status === 'available' ? 'Livre' : 'Ocupado'}
                      </div>
                      {mb.uid !== user?.uid && (
                        <button
                          type="button"
                          onClick={() => unlinkMotoboy(mb)}
                          className="rounded-xl p-2 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="Desvincular motoboy"
                          aria-label={`Desvincular ${displayName}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit Order Modal */}
      <AnimatePresence>
        {editingOrder && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white p-8 rounded-[2.5rem] shadow-2xl max-w-md w-full space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">Editar Pedido</h3>
                <button onClick={() => setEditingOrder(null)} className="text-gray-400 hover:text-gray-600">
                  <Plus className="rotate-45" size={28} />
                </button>
              </div>

              <form onSubmit={handleUpdateOrder} className="space-y-4">
                <div className="space-y-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Dados do Cliente</p>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Nome</label>
                    <input 
                      type="text"
                      className="w-full p-3 bg-white border border-gray-100 rounded-xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={editData.customerName}
                      onChange={e => setEditData({...editData, customerName: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Telefone / WhatsApp</label>
                    <input 
                      type="text"
                      className="w-full p-3 bg-white border border-gray-100 rounded-xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={editData.customerPhone}
                      onChange={e => setEditData({...editData, customerPhone: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Endereço Completo</label>
                    <input 
                      type="text"
                      className="w-full p-3 bg-white border border-gray-100 rounded-xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={editData.customerAddress}
                      onChange={e => setEditData({...editData, customerAddress: e.target.value})}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Medicamentos / Itens</label>
                  <textarea 
                    className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                    value={editData.items}
                    onChange={e => setEditData({...editData, items: e.target.value})}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Valor Total (R$)</label>
                    <input 
                      type="number"
                      step="0.01"
                      className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none"
                      value={editData.totalValue}
                      onChange={e => setEditData({...editData, totalValue: parseFloat(e.target.value)})}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Troco para quanto?</label>
                    {editingOrder?.paymentMethod === 'dinheiro' ? (
                      <>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none"
                          value={editData.change}
                          onChange={e => setEditData({...editData, change: parseFloat(e.target.value) || 0})}
                        />
                        <p className="text-xs font-bold text-emerald-600 mt-1">
                          {editData.change ? `Levar troco de R$ ${money(Math.max(Number(editData.change || 0) - Number(editData.totalValue || 0), 0))}` : 'Sem troco'}
                        </p>
                      </>
                    ) : (
                      <div className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl mt-1 text-sm font-bold text-gray-400">Não se aplica</div>
                    )}
                  </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Tipo de Entrega</label>
                  <div className="flex gap-4 p-2">
                     {(['normal', 'urgente', 'controlado'] as const).map((type) => (
                      <label key={type} className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="radio" 
                          name="editDeliveryTypeLog" 
                          value={type}
                          checked={editData.deliveryType === type}
                          onChange={() => setEditData({...editData, deliveryType: type})}
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={cn(
                          "text-xs font-bold capitalize px-3 py-1 rounded-full",
                          type === 'urgente' ? "bg-red-50 text-red-600" :
                          type === 'controlado' ? "bg-amber-50 text-amber-600" :
                          "bg-gray-100 text-gray-600"
                        )}>
                          {type}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <button 
                type="submit"
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-indigo-700 transition-all mt-4"
              >
                Salvar Alterações
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      {/* QR Code Modal for Printing/Scanning */}
      <AnimatePresence>
        {selectedOrderQR && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center space-y-6"
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold text-gray-900">QR Code do Pedido</h3>
                <button onClick={() => setSelectedOrderQR(null)} className="text-gray-400 hover:text-gray-600">
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>
              
              <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-gray-200 inline-block">
                <QRCodeCanvas 
                  value={selectedOrderQR.id} 
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="space-y-2">
                <p className="font-bold text-lg text-gray-900">{selectedOrderQR.customerName}</p>
                <p className="text-sm text-gray-500">{selectedOrderQR.customerAddress}</p>
                <p className="text-xs font-mono text-indigo-600 bg-indigo-50 py-1 px-2 rounded inline-block">
                  ID: {selectedOrderQR.id}
                </p>
              </div>

              <button 
                onClick={() => window.print()}
                className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={20} /> Imprimir Etiqueta
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const RouteMap = ({ order, onUpdateLocation }: { order: Order, onUpdateLocation: (lat: number, lng: number) => void }) => {
  const [currentPos, setCurrentPos] = useState<[number, number] | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if ("geolocation" in navigator) {
      watchId.current = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setCurrentPos([latitude, longitude]);
          onUpdateLocation(latitude, longitude);
        },
        (error) => console.error(error),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    }
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

  if (!currentPos || !order.customerLocation) return (
    <div className="h-64 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
        <Navigation size={24} />
      </motion.div>
      <span className="ml-2 font-medium">Obtendo localização...</span>
    </div>
  );

  const customerPos: [number, number] = [order.customerLocation.lat, order.customerLocation.lng];

  return (
    <div className="h-96 rounded-2xl overflow-hidden border border-gray-200 shadow-inner relative">
      <MapContainer center={currentPos} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={currentPos}>
          <Popup>Você está aqui</Popup>
        </Marker>
        <Marker position={customerPos}>
          <Popup>Destino: {order.customerName}</Popup>
        </Marker>
        <ChangeView center={currentPos} />
      </MapContainer>
      <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur p-3 rounded-xl shadow-lg z-[1000] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
            <Navigation size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Destino</p>
            <p className="text-sm font-bold text-gray-900 truncate max-w-[150px]">{order.customerAddress}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</p>
          <p className="text-sm font-bold text-emerald-600">Em Rota</p>
        </div>
      </div>
    </div>
  );
};

const MotoboyView = () => {
  const { user } = useAuth();
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [completingOrder, setCompletingOrder] = useState<Order | null>(null);
  const [activeRouteOrder, setActiveRouteOrder] = useState<Order | null>(null);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('cliente');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    
    // Minhas ordens atribuídas
    const qMy = query(
      collection(db, 'orders'), 
      where('pharmacyId', '==', getPharmacyId(user)),
      where('motoboyId', '==', user.uid), 
      where('status', 'in', ['approved', 'in_transit', 'delivered']),
      limit(50)
    );
    const unsubMy = onSnapshot(qMy, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setMyOrders(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });

    // Ordens disponíveis para coleta
    const qAvailable = query(
      collection(db, 'orders'), 
      where('pharmacyId', '==', getPharmacyId(user)),
      where('status', '==', 'approved'),
      where('motoboyId', '==', null)
    );
    const unsubAvailable = onSnapshot(qAvailable, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      docs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setAvailableOrders(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });

    return () => {
      unsubMy();
      unsubAvailable();
    };
  }, [user]);

  const startDelivery = async (id: string) => {
    const path = `orders/${id}`;
    try {
      const orderDoc = await getDoc(doc(db, 'orders', id));
      const orderData = orderDoc.data() as Order;

      await updateDoc(doc(db, 'orders', id), {
        status: 'in_transit',
        inTransitAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // WhatsApp Notification
      const message = getWhatsAppMessage({ ...orderData, status: 'in_transit' } as Order);
      window.open(message, '_blank');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const pickupOrder = async (id: string) => {
    if (!user) return;
    const path = `orders/${id}`;
    try {
      await updateDoc(doc(db, 'orders', id), {
        motoboyId: user.uid,
        motoboyName: user.name,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handleQRScan = async (orderId: string) => {
    if (!user) return;
    const path = `orders/${orderId}`;
    try {
      const orderDoc = await getDoc(doc(db, 'orders', orderId));
      if (orderDoc.exists()) {
        await updateDoc(doc(db, 'orders', orderId), {
          motoboyId: user.uid,
          motoboyName: user.name,
          status: 'in_transit',
          updatedAt: serverTimestamp()
        });
        setIsScanning(false);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCapturedPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const completeDelivery = async () => {
    if (!completingOrder) return;
    const path = `orders/${completingOrder.id}`;
    try {
      await updateDoc(doc(db, 'orders', completingOrder.id), {
        status: 'delivered',
        deliveredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        deliveryLocation: deliveryLocation,
        deliveryProof: {
          description: deliveryNote,
          timestamp: serverTimestamp(),
          photoUrl: capturedPhoto || `https://picsum.photos/seed/${completingOrder.id}/400/300`
        }
      });

      // WhatsApp Notification
      const message = getWhatsAppMessage({ ...completingOrder, status: 'delivered', deliveryLocation } as Order);
      window.open(message, '_blank');

      setCompletingOrder(null);
      setDeliveryNote('');
      setCapturedPhoto(null);
      setDeliveryLocation('cliente');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const updateLocation = async (orderId: string, lat: number, lng: number) => {
    const path = `orders/${orderId}`;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        location: { lat, lng },
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating location:', error);
    }
  };

  // Simulate location updates only if no active route
  useEffect(() => {
    if (activeRouteOrder) return;
    const activeOrders = myOrders.filter(o => o.status === 'in_transit');
    if (activeOrders.length === 0) return;
    const interval = setInterval(() => {
      activeOrders.forEach(order => {
        const path = `orders/${order.id}`;
        // In a real app, this would use navigator.geolocation
        const lat = -23.5505 + (Math.random() - 0.5) * 0.01;
        const lng = -46.6333 + (Math.random() - 0.5) * 0.01;
        updateDoc(doc(db, 'orders', order.id), {
          location: { lat, lng },
          updatedAt: serverTimestamp()
        }).catch(error => handleFirestoreError(error, OperationType.UPDATE, path));
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [myOrders, activeRouteOrder]);

  const toggleStatus = async () => {
    if (!user) return;
    const path = `users/${user.uid}`;
    const newStatus = user.status === 'available' ? 'unavailable' : 'available';
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        status: newStatus
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const deleteOrder = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este pedido?')) return;
    const path = `orders/${id}`;
    try {
      await deleteDoc(doc(db, 'orders', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-600">
            <UserIcon size={32} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Olá, {user?.name}</h2>
            <div className="flex items-center gap-2">
              <span className={cn(
                "w-2 h-2 rounded-full",
                user?.status === 'available' ? "bg-emerald-500 animate-pulse" : "bg-red-500"
              )} />
              <p className="text-sm font-medium text-gray-500">
                Status: {user?.status === 'available' ? 'Disponível para entregas' : 'Indisponível'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button 
            onClick={toggleStatus}
            className={cn(
              "flex-1 md:flex-none px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
              user?.status === 'available' 
                ? "bg-red-50 text-red-600 hover:bg-red-100" 
                : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
            )}
          >
            {user?.status === 'available' ? 'Ficar Indisponível' : 'Ficar Disponível'}
          </button>
          <button 
            onClick={() => setIsScanning(true)}
            className="flex-1 md:flex-none bg-indigo-600 text-white px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 font-bold justify-center"
          >
            <ScanLine size={20} /> Escanear QR
          </button>
        </div>
      </div>
      
      {/* Section: Entregas em Andamento */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Bike className="text-indigo-600" size={20} /> Entregas em Andamento
            <span className="bg-indigo-100 text-indigo-600 text-xs px-2 py-0.5 rounded-full">
              {myOrders.filter(o => o.status !== 'delivered').length}
            </span>
          </h3>
        </div>
        
        {myOrders.filter(o => o.status !== 'delivered').length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-dashed border-gray-200 text-center">
            <p className="text-gray-400">Você não tem entregas em andamento no momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {myOrders.filter(o => o.status !== 'delivered').map(order => (
              <motion.div 
                key={order.id} 
                className={cn(
                  "bg-white p-6 rounded-2xl shadow-lg border transition-all",
                  order.status === 'in_transit' ? "border-indigo-200 ring-2 ring-indigo-50" : "border-gray-100"
                )}
              >
                <div className="flex flex-col h-full">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider">#{order.orderCode}</span>
                        <StatusBadge status={order.status} />
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 leading-tight">{order.customerName}</h3>
                    </div>
                  </div>

                  {/* Address Section */}
                  <div className="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100">
                    <div className="flex items-start gap-2">
                      <MapPin size={16} className="text-indigo-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Endereço</p>
                        <p className="text-sm font-semibold text-gray-800">{order.customerAddress}</p>
                      </div>
                    </div>
                  </div>

                  {/* Order Details Grid */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Itens</p>
                      <p className="text-xs font-medium text-gray-700 line-clamp-2">{order.items}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Pagamento</p>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase">{order.paymentMethod ? paymentMethodLabels[order.paymentMethod] : 'N/D'}</span>
                        {order.totalValue && (
                          <p className="text-sm font-bold text-gray-900">
                            R$ {order.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Section */}
                  <div className="mt-auto space-y-3">
                    {/* Communication Bar */}
                    <div className="grid grid-cols-2 gap-2">
                      <a 
                        href={`tel:${order.customerPhone}`}
                        className="bg-white border border-gray-200 text-gray-700 h-12 rounded-xl flex items-center justify-center gap-2 font-bold hover:bg-gray-50 transition-all text-xs active:scale-95"
                      >
                        <Phone size={14} className="text-indigo-600" /> Ligar
                      </a>
                      <a 
                        href={`https://wa.me/${order.customerPhone?.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-emerald-50 text-emerald-700 h-12 rounded-xl flex items-center justify-center gap-2 font-bold hover:bg-emerald-100 transition-all text-xs active:scale-95 border border-emerald-100"
                      >
                        <MessageSquare size={14} /> WhatsApp
                      </a>
                    </div>

                    {/* Primary Status Actions */}
                    {order.status === 'approved' && (
                      <HoldButton 
                        onComplete={() => startDelivery(order.id)}
                        className="w-full bg-indigo-600 text-white h-14 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95"
                      >
                        <Navigation size={18} /> SEGURE PARA INICIAR
                      </HoldButton>
                    )}

                    {order.status === 'in_transit' && (
                      <div className="grid grid-cols-1 gap-2">
                        <button 
                          onClick={() => setActiveRouteOrder(order)}
                          className="w-full bg-blue-600 text-white h-14 rounded-xl flex items-center justify-center gap-2 font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95"
                        >
                          <Map size={18} /> VER ROTA / MAPA
                        </button>
                        <button 
                          onClick={() => setCompletingOrder(order)}
                          className="w-full bg-emerald-600 text-white h-14 rounded-xl flex items-center justify-center gap-2 font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95"
                        >
                          <CheckCircle2 size={18} /> FINALIZAR ENTREGA
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    <div className="flex items-center gap-1.5">
                      <Clock size={10} className="text-gray-300" /> {order.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                    </div>
                  </div>
                </div>
              </motion.div>

            ))}
          </div>
        )}
      </section>

      {/* Route Modal */}
      <AnimatePresence>
        {activeRouteOrder && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Rota de Entrega</h3>
                  <p className="text-sm text-gray-500">Acompanhando pedido #{activeRouteOrder.orderCode}</p>
                </div>
                <button 
                  onClick={() => setActiveRouteOrder(null)}
                  className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>
              
              <div className="p-6">
                <RouteMap 
                  order={activeRouteOrder} 
                  onUpdateLocation={(lat, lng) => updateLocation(activeRouteOrder.id, lat, lng)} 
                />
              </div>

              <div className="p-6 bg-gray-50 flex gap-3">
                <button 
                  onClick={() => setActiveRouteOrder(null)}
                  className="flex-1 bg-white border border-gray-200 py-3 rounded-xl font-bold text-gray-700 hover:bg-gray-100 transition-all text-xs uppercase"
                >
                  Fechar Mapa
                </button>
                <button 
                  onClick={() => {
                    setCompletingOrder(activeRouteOrder);
                    setActiveRouteOrder(null);
                  }}
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-emerald-700 transition-all text-xs uppercase"
                >
                  Finalizar Entrega
                </button>
              </div>
            </motion.div>

          </div>
        )}
      </AnimatePresence>

      {/* Section: Pedidos Disponíveis para Coleta */}
      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Package className="text-amber-500" size={20} /> Pedidos Disponíveis
            <span className="bg-amber-100 text-amber-600 text-xs px-2 py-0.5 rounded-full">{availableOrders.length}</span>
          </h3>
          <button 
            onClick={() => setIsScanning(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            <QrCode size={18} /> Escanear QR Code
          </button>
        </div>
        
        {availableOrders.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-dashed border-gray-200 text-center">
            <p className="text-gray-400">Não há novas entregas aguardando coleta.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableOrders.map(order => (
              <motion.div 
                key={order.id} 
                className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex flex-col h-full">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-wider">#{order.orderCode}</span>
                        {order.deliveryType && order.deliveryType !== 'normal' ? (
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                            order.deliveryType === 'urgente' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                          )}>
                            {order.deliveryType}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase">Pronto</span>
                        )}
                      </div>
                      <h4 className="font-bold text-gray-900 truncate">{order.customerName}</h4>
                    </div>
                  </div>

                  <div className="flex items-start gap-1 mb-3">
                    <MapPin size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-gray-500 truncate">{order.customerAddress}</p>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-gray-400 flex items-center gap-1 uppercase tracking-widest">
                      <Clock size={12} className="text-gray-300" /> {order.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                    </span>
                  </div>
                </div>
              </motion.div>

            ))}
          </div>
        )}
      </section>

      {/* Section: Entregas Concluídas */}
      <section className="space-y-4">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <CheckCircle2 className="text-emerald-500" size={20} /> Entregas Concluídas
          <span className="bg-emerald-100 text-emerald-600 text-xs px-2 py-0.5 rounded-full">
            {myOrders.filter(o => o.status === 'delivered').length}
          </span>
        </h3>
        
        {myOrders.filter(o => o.status === 'delivered').length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-dashed border-gray-200 text-center">
            <p className="text-gray-400">Nenhuma entrega concluída recentemente.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myOrders.filter(o => o.status === 'delivered').map(order => (
              <motion.div 
                key={order.id} 
                className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm opacity-80"
              >
                <div className="flex flex-col h-full">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded uppercase tracking-wider">#{order.orderCode}</span>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase">Entregue</span>
                      </div>
                      <h4 className="font-bold text-gray-900 truncate">{order.customerName}</h4>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 truncate mb-3">{order.customerAddress}</p>
                  <div className="mt-auto flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase">
                    <div className="flex items-center gap-1">
                      <Clock size={10} /> {order.createdAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                    </div>
                    <div className="flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 size={10} /> {order.deliveredAt?.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '--:--'}
                    </div>
                  </div>
                </div>
              </motion.div>

            ))}
          </div>
        )}
      </section>

      {isScanning && (
        <QRScanner 
          onScan={handleQRScan} 
          onClose={() => setIsScanning(false)} 
        />
      )}

      {/* Delivery Proof Modal */}
      <AnimatePresence>
        {completingOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[3000] backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4"
            >
              <div>
                <h3 className="text-xl font-bold text-gray-900">Finalizar Entrega</h3>
                <p className="text-sm text-gray-500">Confirme os detalhes da entrega para {completingOrder.customerName}.</p>
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Comprovante de Foto (opcional)</label>
                <input 
                  type="file" 
                  accept="image/*" 
                  capture="environment"
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handlePhotoCapture}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "w-full aspect-video rounded-xl overflow-hidden relative cursor-pointer border-2 border-dashed transition-all flex flex-col items-center justify-center gap-2",
                    capturedPhoto ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-gray-50 hover:border-indigo-200"
                  )}
                >
                  {capturedPhoto ? (
                    <img src={capturedPhoto} alt="Captured" className="w-full h-full object-cover" />
                  ) : (
                    <>
                      <Camera size={32} className="text-gray-400" />
                      <span className="text-xs font-medium text-gray-400 uppercase">Tirar Foto</span>
                    </>
                  )}
                </button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Quem recebeu?</label>
                  <select 
                    className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50"
                    value={deliveryLocation}
                    onChange={e => setDeliveryLocation(e.target.value)}
                  >
                    <option value="cliente">Próprio Cliente</option>
                    <option value="vizinho">Vizinho</option>
                    <option value="portaria">Portaria / Condomínio</option>
                    <option value="caixa_correio">Caixa de Correio</option>
                    <option value="outro">Outro Local Especificado</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Notas (opcional)</label>
                  <textarea 
                    placeholder="Observações sobre a entrega..."
                    className="w-full p-3 border border-gray-200 rounded-xl text-sm h-24 focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50"
                    value={deliveryNote}
                    onChange={e => setDeliveryNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => {
                    setCompletingOrder(null);
                    setCapturedPhoto(null);
                  }}
                  className="flex-1 py-3 text-gray-500 font-bold text-xs uppercase"
                >
                  Cancelar
                </button>
                <HoldButton 
                  onComplete={completeDelivery}
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold text-xs uppercase shadow-lg shadow-emerald-100"
                >
                  <CheckCircle2 size={16} /> SEGURE PARA CONFIRMAR
                </HoldButton>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

const getWhatsAppMessage = (order: Order) => {
  const statusMap: Record<string, string> = {
    pending: "está pendente de aprovação",
    approved: "foi aprovado e está sendo preparado",
    ready: "está pronto para entrega",
    in_transit: "está em rota de entrega",
    delivered: "foi entregue com sucesso",
    cancelled: "foi cancelado"
  };

  let text = `Olá ${order.customerName}! O status do seu pedido #${order.orderCode} na FarmaEntrega ${statusMap[order.status] || 'foi atualizado'}.`;
  
  if (order.status === 'cancelled' && order.cancellationReason) {
    text += ` Motivo: ${order.cancellationReason}`;
  } else if (order.status !== 'cancelled') {
    text += ` Acompanhe aqui: ${window.location.origin}/track/${order.orderCode}`;
  }

  return `https://wa.me/${order.customerPhone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
};

const ClientTrackingMap = ({ order }: { order: Order }) => {
  if (!order.location || !order.customerLocation) return (
    <div className="h-64 bg-gray-50 rounded-2xl flex flex-col items-center justify-center text-gray-400 gap-3 border border-dashed border-gray-200 mb-6">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
        <MapPin size={24} />
      </div>
      <p className="text-sm font-medium">Aguardando sinal de GPS do entregador...</p>
    </div>
  );

  const motoboyPos: [number, number] = [order.location.lat, order.location.lng];
  const customerPos: [number, number] = [order.customerLocation.lat, order.customerLocation.lng];

  return (
    <div className="h-80 rounded-3xl overflow-hidden border border-gray-100 shadow-lg mb-8 relative group">
      <MapContainer center={motoboyPos} zoom={14} style={{ height: '100%', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={motoboyPos}>
          <Popup>Entregador: {order.motoboyName}</Popup>
        </Marker>
        <Marker position={customerPos}>
          <Popup>Seu Endereço</Popup>
        </Marker>
        <ChangeView center={motoboyPos} />
      </MapContainer>
      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg z-[1000] flex items-center gap-2">
        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        <span className="text-xs font-bold text-gray-700">Localização em tempo real</span>
      </div>
    </div>
  );
};

const ClientView = ({ 
  initialTab = 'shop', 
  cartState, 
  cartBump 
}: { 
  initialTab?: any, 
  cartState: [CartItem[], React.Dispatch<React.SetStateAction<CartItem[]>>],
  cartBump: boolean
}) => {
  const [activeTab, setActiveTab] = useState<'shop' | 'categories' | 'tracking' | 'orders' | 'cart' | 'checkout' | 'product' | 'favorites' | 'account'>(initialTab);
  
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [order, setOrder] = useState<Order | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = cartState;
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('farmaentrega_favorites');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('farmaentrega_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const storePharmacyId = new URLSearchParams(location.search).get('pharmacyId') || DEFAULT_PHARMACY_ID;

  const toggleFavorite = (productId: string) => {
    setFavorites(prev => 
      prev.includes(productId) 
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  const categories = [
    { id: 'meds', name: 'Medicamentos', icon: Package, color: 'bg-red-50 text-red-600', gradient: 'from-red-50 to-red-100' },
    { id: 'hygiene', name: 'Higiene', icon: Droplets, color: 'bg-blue-50 text-blue-600', gradient: 'from-blue-50 to-blue-100' },
    { id: 'baby', name: 'Mamãe & Bebê', icon: Heart, color: 'bg-pink-50 text-pink-600', gradient: 'from-pink-50 to-pink-100' },
    { id: 'vitamins', name: 'Vitaminas', icon: Zap, color: 'bg-amber-50 text-amber-600', gradient: 'from-amber-50 to-amber-100' },
    { id: 'beauty', name: 'Beleza', icon: UserCircle, color: 'bg-purple-50 text-purple-600', gradient: 'from-purple-50 to-purple-100' },
    { id: 'first-aid', name: 'Primeiros Socorros', icon: Stethoscope, color: 'bg-emerald-50 text-emerald-600', gradient: 'from-emerald-50 to-emerald-100' },
  ];

  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [storeConfig, setStoreConfig] = useState<PharmacyProfile>(() => getDefaultPharmacyProfile(DEFAULT_PHARMACY_ID));
  
  useEffect(() => {
    const q = query(collection(db, 'products'), where('pharmacyId', '==', storePharmacyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      docs.sort((a, b) => a.name.localeCompare(b.name));
      setFeaturedProducts(docs);
    }, (error) => {
      console.error("Erro ao carregar produtos:", error);
    });

    getDoc(doc(db, 'pharmacies', storePharmacyId)).then(snap => {
      setStoreConfig(snap.exists()
        ? ({ ...getDefaultPharmacyProfile(storePharmacyId), ...snap.data() } as PharmacyProfile)
        : getDefaultPharmacyProfile(storePharmacyId)
      );
    });

    return () => unsubscribe();
  }, [storePharmacyId]);

  const displayedProducts = selectedCategory 
    ? featuredProducts.filter(p => p.category === selectedCategory) 
    : featuredProducts;

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="max-w-full mx-auto p-4 lg:p-12">
        {/* Main Content */}
        <main className="space-y-8 min-w-0">
          <AnimatePresence mode="wait">
            {activeTab === 'shop' && (
              <motion.div 
                key="shop"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-12"
              >
                {/* Search Header Desktop */}
                <div className="flex items-center justify-between gap-6">
                  <div className="flex-1 relative group">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                    <input 
                      type="text" 
                      placeholder="Busque por produtos, medicamentos ou sintomas..."
                      className="w-full bg-white border border-gray-100 p-5 pl-14 rounded-3xl text-sm font-medium shadow-sm focus:ring-4 focus:ring-indigo-50 focus:border-indigo-400 outline-none transition-all"
                    />
                  </div>
                  <div className="hidden lg:flex items-center gap-4">
                    <button className="flex items-center gap-2 bg-white px-5 py-5 rounded-3xl border border-gray-100 shadow-sm hover:bg-gray-50 transition-all font-bold text-gray-700">
                      <MapPin size={18} className="text-indigo-600" />
                      <span className="text-sm">Entrega: <span className="text-indigo-600">Centro</span></span>
                      <ChevronDown size={14} className="text-gray-400" />
                    </button>
                    <button 
                      onClick={() => setActiveTab('cart')}
                      className="bg-indigo-600 text-white px-6 py-5 rounded-3xl shadow-xl shadow-indigo-100 flex items-center gap-3 hover:scale-105 active:scale-95 transition-all"
                    >
                      <ShoppingCart size={20} />
                      <span className="font-bold text-sm tracking-tight text-white">R$ {cartTotal.toFixed(2)}</span>
                    </button>
                  </div>
                </div>

                {/* Promo Banner */}
                {!selectedCategory && (
                  <div className="bg-indigo-900 rounded-[3rem] p-8 md:p-14 text-white relative overflow-hidden shadow-2xl group">
                    <img 
                      src={storeConfig.heroImage} 
                      className="absolute inset-0 w-full h-full object-cover opacity-20 filter grayscale"
                      alt="Store Hero"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-950 via-indigo-900/40 to-transparent" />
                    <div className="relative z-10 max-w-xl space-y-6">
                      <div className="inline-flex items-center gap-2 bg-emerald-500/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-emerald-500/30">
                        <Zap size={14} className="text-emerald-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-200">Entrega Expressa Grátis</span>
                      </div>
                      <h2 className="text-4xl md:text-6xl font-black italic tracking-tighter leading-[0.9] text-white">
                        {storeConfig.title}
                      </h2>
                      <p className="text-indigo-100/70 font-medium text-lg max-w-md">
                        {storeConfig.description.replace('{time}', storeConfig.deliveryTime)}
                      </p>
                      <div className="flex flex-wrap gap-4 pt-4">
                        <button 
                          onClick={() => setActiveTab('categories')}
                          className="bg-white text-indigo-950 px-8 py-5 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-950 hover:bg-indigo-50 transition-all active:scale-95"
                        >
                          Explorar Produtos
                        </button>
                        <button className="bg-white/10 backdrop-blur-md text-white border border-white/20 px-8 py-5 rounded-[2rem] font-black uppercase tracking-widest text-xs hover:bg-white/20 transition-all">
                          Ver Ofertas
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Categories Grid */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between px-2">
                    <h3 className="text-2xl font-black text-gray-900 tracking-tight italic">Navegar Categorias</h3>
                    <button className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:opacity-70 transition-all">Ver Todas</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                    {categories.map(cat => (
                      <button 
                        key={cat.id}
                        onClick={() => { setSelectedCategory(cat.name); setActiveTab('shop'); }}
                        className={cn(
                          "relative group p-6 rounded-[2rem] flex flex-col items-center gap-4 transition-all hover:-translate-y-1 active:scale-95 border border-transparent hover:border-gray-100 bg-white shadow-sm overflow-hidden"
                        )}
                      >
                        <div className={cn("absolute inset-x-0 bottom-0 h-1 transition-all group-hover:h-2 opacity-20", cat.color.replace('text-', 'bg-'))} />
                        <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all group-hover:scale-110", cat.color)}>
                          <cat.icon size={28} />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.1em] text-gray-800 text-center leading-tight">{cat.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Featured Products */}
                <div className="space-y-8">
                  <div className="flex items-center justify-between px-2">
                    <div className="space-y-1">
                      {selectedCategory ? (
                        <>
                          <h3 className="text-2xl font-black text-gray-900 tracking-tight italic">{selectedCategory}</h3>
                          <button onClick={() => setSelectedCategory(null)} className="text-xs font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-1">
                            <ArrowLeft size={12} /> Voltar para todas as ofertas
                          </button>
                        </>
                      ) : (
                        <>
                          <h3 className="text-2xl font-black text-gray-900 tracking-tight italic">Promoções Imperdíveis</h3>
                          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Ofertas válidas enquanto durar o estoque</p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {(selectedCategory ? displayedProducts : displayedProducts.slice(0, 3)).map(product => (
                      <ProductCard key={product.id} product={product} onAdd={addToCart} onUpdateQuantity={updateQuantity} onView={(p) => { setSelectedProduct(p); setActiveTab('product'); }} cartItems={cart} isFavorite={favorites.includes(product.id)} onToggleFavorite={toggleFavorite} />
                    ))}
                    {selectedCategory && displayedProducts.length === 0 && (
                      <div className="col-span-3 py-10 text-center">
                        <p className="text-gray-400 font-bold">Nenhum produto encontrado nesta categoria.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Fast Delivery Section */}
                <div className="bg-amber-50 rounded-[3rem] p-10 border border-amber-100 flex flex-col md:flex-row items-center gap-10">
                  <div className="flex-1 space-y-6">
                    <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-amber-200">
                      <Bike size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-3xl font-black text-gray-900 tracking-tighter italic">Medicamentos com urgência?</h3>
                      <p className="text-gray-600 font-medium">Nossa frota de motoboys está pronta para te atender. Entrega prioritária disponível 24h para toda a região.</p>
                    </div>
                    <button className="bg-amber-500 text-white px-8 py-4 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all">
                      Ver Itens Disponíveis
                    </button>
                  </div>
                  <div className="w-full md:w-64 aspect-square bg-white rounded-[2.5rem] p-4 shadow-xl border border-amber-50">
                    <img 
                      src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=400&h=400&fit=crop" 
                      className="w-full h-full object-cover rounded-[2rem]" 
                      alt="Pharmacy"
                    />
                  </div>
                </div>

                {/* More Products (Only show if no category is selected) */}
                {!selectedCategory && (
                  <div className="space-y-8">
                    <h3 className="text-2xl font-black text-gray-900 tracking-tight italic italic px-2">Mais Procurados</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      {featuredProducts.slice(3).map(product => (
                        <ProductCard key={product.id} product={product} onAdd={addToCart} onUpdateQuantity={updateQuantity} onView={(p) => { setSelectedProduct(p); setActiveTab('product'); }} cartItems={cart} isFavorite={favorites.includes(product.id)} onToggleFavorite={toggleFavorite} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Warning Footer */}
                <div className="bg-gray-100 rounded-3xl p-6 text-center border border-gray-200/50">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] max-w-2xl mx-auto leading-relaxed">
                    A FarmaEntrega informa: Medicamentos podem causar efeitos colaterais. Alguns produtos exigem retenção de receita e aprovação prévia do farmacêutico responsável.
                  </p>
                </div>
              </motion.div>
            )}

            {activeTab === 'product' && selectedProduct && (
              <motion.div 
                key="product"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-8"
              >
                <button onClick={() => setActiveTab('shop')} className="flex items-center gap-2 text-gray-400 hover:text-indigo-600 transition-all font-black uppercase text-[10px] tracking-widest">
                  <ArrowLeft size={16} /> Voltar para Loja
                </button>
                <div className="bg-white rounded-[3rem] shadow-2xl p-8 md:p-12 border border-gray-100 flex flex-col md:flex-row gap-12">
                  <div className="w-full md:w-1/2 aspect-square bg-gray-50 rounded-[2.5rem] overflow-hidden">
                    <img src={selectedProduct.image} className="w-full h-full object-cover" alt={selectedProduct.name} />
                  </div>
                  <div className="flex-1 space-y-8">
                    <div className="space-y-4">
                      {selectedProduct.requiresApproval && (
                        <span className="inline-flex items-center gap-2 bg-amber-50 text-amber-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-100">
                          <Clock size={12} /> Exige Aprovação
                        </span>
                      )}
                      <h2 className="text-4xl font-black text-gray-900 tracking-tighter italic leading-tight">{selectedProduct.name}</h2>
                      <div className="flex items-center gap-4">
                         <span className="text-3xl font-black text-indigo-600 tracking-tight">R$ {selectedProduct.price.toFixed(2)}</span>
                         {selectedProduct.originalPrice && (
                           <span className="text-lg text-gray-300 line-through font-bold">R$ {selectedProduct.originalPrice.toFixed(2)}</span>
                         )}
                      </div>
                      <p className="text-gray-500 font-medium leading-relaxed">{selectedProduct.description}</p>
                      
                      {/* Accordion Detalhes do Produto */}
                      <div className="space-y-4 pt-4 border-t border-gray-100">
                        <ProductAccordionItem 
                          title="Descrição" 
                          content={selectedProduct.description} 
                        />
                        <ProductAccordionItem 
                          title="Especificações" 
                          content={selectedProduct.specifications || "Informações nutricionais e princípios ativos conforme embalagem."} 
                        />
                        <ProductAccordionItem 
                          title="Como Usar" 
                          content={selectedProduct.howToUse || "Siga as orientações médicas ou do fabricante."} 
                        />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        {cart.find(i => i.id === selectedProduct.id) ? (
                          <div className="flex-1 flex items-center bg-gray-100 rounded-[2rem] h-16 p-2 gap-4">
                            <motion.button 
                              whileTap={{ scale: 0.9 }}
                              onClick={() => updateQuantity(selectedProduct.id, -1)}
                              className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-gray-600 shadow-sm hover:text-indigo-600"
                            >
                              <Minus size={20} />
                            </motion.button>
                            <span className="flex-1 text-center font-black text-lg text-gray-900 italic">
                              {cart.find(i => i.id === selectedProduct.id)?.quantity} <span className="text-[10px] opacity-40 uppercase tracking-widest">unidades</span>
                            </span>
                            <motion.button 
                              whileTap={{ scale: 0.9 }}
                              onClick={() => addToCart(selectedProduct)}
                              className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-gray-600 shadow-sm hover:text-indigo-600"
                            >
                              <Plus size={20} />
                            </motion.button>
                          </div>
                        ) : (
                          <motion.button 
                            whileTap={{ scale: 0.95 }}
                            onClick={() => addToCart(selectedProduct)}
                            className="flex-1 bg-indigo-600 text-white h-16 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-3"
                          >
                            <ShoppingCart size={20} /> Adicionar ao Carrinho
                          </motion.button>
                        )}
                        <motion.button 
                          whileTap={{ scale: 0.9 }}
                          onClick={() => toggleFavorite(selectedProduct.id)}
                          className={cn(
                            "w-16 h-16 rounded-[2rem] flex items-center justify-center transition-all border",
                            favorites.includes(selectedProduct.id) 
                              ? "bg-pink-500 text-white border-pink-500 shadow-lg shadow-pink-100" 
                              : "bg-pink-50 bg-pink-50 text-pink-600 border-pink-100 hover:bg-pink-100"
                          )}
                        >
                          <Heart size={24} fill={favorites.includes(selectedProduct.id) ? "currentColor" : "none"} />
                        </motion.button>
                      </div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Entrega estimada: 30-50 minutos</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'cart' && (
              <motion.div 
                key="cart"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-4xl font-black text-gray-900 tracking-tight italic">Meu Carrinho</h3>
                  <button onClick={() => setCart([])} className="text-[11px] font-black uppercase tracking-widest text-red-500 hover:opacity-70 transition-all">LIMPAR TUDO</button>
                </div>

                {cart.length === 0 ? (
                  <div className="bg-white p-8 md:p-16 rounded-[2rem] md:rounded-[3rem] shadow-xl border border-gray-100 text-center space-y-6 md:space-y-8">
                    <div className="w-20 h-20 md:w-24 md:h-24 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto text-indigo-600 shadow-inner">
                      <ShoppingCart size={40} className="md:w-12 md:h-12" />
                    </div>
                    <div className="space-y-2">
                       <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight italic">Seu carrinho está vazio</h2>
                       <p className="text-gray-400 font-medium text-sm md:text-base">Adicione produtos para começar a cuidar da sua saúde hoje mesmo.</p>
                    </div>
                    <button 
                      onClick={() => setActiveTab('shop')}
                      className="bg-indigo-600 text-white px-8 md:px-10 py-4 md:py-5 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all"
                    >
                      Voltar para Loja
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    <div className="space-y-4">
                      {cart.map(item => (
                        <div key={item.id} className="bg-white p-4 md:p-6 rounded-[2rem] shadow-sm border border-gray-50 flex flex-col md:flex-row md:items-center gap-4 hover:shadow-xl transition-all relative">
                          <div className="flex items-center gap-4">
                            <div className="w-20 h-20 md:w-24 md:h-24 bg-gray-50 rounded-[1.5rem] overflow-hidden shrink-0 border border-gray-50">
                              <img src={item.image} className="w-full h-full object-cover" alt={item.name} />
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 truncate">{item.category}</p>
                              <h4 className="text-sm md:text-base font-bold text-gray-900 leading-tight mb-2 line-clamp-2">{item.name}</h4>
                              <div className="flex items-baseline gap-1">
                                <span className="text-indigo-600 font-black text-xs uppercase opacity-80">R$</span>
                                <span className="text-indigo-600 font-black text-xl md:text-2xl tracking-tight">{item.price.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between md:justify-end gap-4 mt-2 md:mt-0 w-full md:w-auto">
                             <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                               <motion.button 
                                 whileTap={{ scale: 0.8 }}
                                 onClick={() => updateQuantity(item.id, -1)} 
                                 className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-white rounded-xl transition-all font-black text-lg"
                               >
                                 -
                               </motion.button>
                               
                               <div className="w-8 flex items-center justify-center">
                                 <span className="font-black text-lg text-gray-900">{item.quantity}</span>
                               </div>

                               <motion.button 
                                 whileTap={{ scale: 0.8 }}
                                 onClick={() => updateQuantity(item.id, 1)} 
                                 className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-white rounded-xl transition-all font-black text-lg"
                               >
                                 +
                               </motion.button>
                             </div>
                             
                             <button 
                               onClick={() => removeFromCart(item.id)}
                               className="p-2.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all flex items-center gap-2"
                             >
                               <Trash2 size={20} />
                               <span className="md:hidden text-xs font-bold uppercase tracking-widest">Remover</span>
                             </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 md:mt-8">
                      <div className="bg-white p-6 md:p-10 rounded-[2rem] md:rounded-[3rem] shadow-xl border border-gray-50 space-y-6 md:space-y-10">
                         <h4 className="font-black text-gray-900 tracking-tight italic uppercase text-xl md:text-2xl">RESUMO DO PEDIDO</h4>
                         <div className="space-y-4 md:space-y-6">
                           <div className="flex justify-between items-center">
                             <span className="text-gray-400 font-medium text-lg md:text-xl">Subtotal</span>
                             <span className="font-black text-gray-900 text-xl md:text-2xl">R$ {cartTotal.toFixed(2)}</span>
                           </div>
                           <div className="flex justify-between items-center">
                             <span className="text-gray-400 font-medium text-lg md:text-xl">Entrega</span>
                             <span className="text-emerald-500 font-black uppercase text-xs bg-emerald-50 px-4 py-1.5 rounded-xl">GRÁTIS</span>
                           </div>
                           <div className="h-px bg-gray-100" />
                           <div className="flex justify-between items-center">
                             <span className="font-black text-gray-900 italic text-2xl md:text-3xl uppercase tracking-tighter">Total</span>
                             <span className="font-black text-indigo-600 tracking-tighter text-3xl md:text-4xl">R$ {cartTotal.toFixed(2)}</span>
                           </div>
                         </div>
                         <button 
                          onClick={() => setActiveTab('checkout')}
                          className="w-full bg-indigo-600 text-white h-16 md:h-20 rounded-[2rem] font-black uppercase tracking-widest text-base md:text-lg shadow-xl shadow-indigo-100 hover:bg-indigo-700 hover:scale-[1.02] active:scale-95 transition-all mt-4"
                         >
                           Finalizar Compra
                         </button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'checkout' && (
              <motion.div 
                key="checkout"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-2xl mx-auto space-y-8"
              >
                <div className="text-center space-y-2">
                  <h3 className="text-4xl font-black text-gray-900 tracking-tighter italic leading-tight">Finalizar Pedido</h3>
                  <p className="text-gray-400 font-medium text-lg italic">Falta pouco para cuidarmos de você!</p>
                </div>
                <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-gray-100">
                  <CheckoutForm pixKey={storeConfig.pixKey} pharmacyId={storePharmacyId} cart={cart} total={cartTotal} onComplete={(o) => { setOrder(o); setActiveTab('tracking'); setCart([]); }} />
                </div>
              </motion.div>
            )}

            {activeTab === 'tracking' && (
              <motion.div 
                key="tracking"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                {!order ? (
                  <div className="bg-white p-16 rounded-[3rem] shadow-2xl border border-gray-100 text-center space-y-8">
                    <div className="w-24 h-24 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto text-indigo-600 shadow-inner">
                      <Bike size={48} />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-3xl font-black text-gray-900 tracking-tight italic">Onde está seu pedido?</h2>
                      <p className="text-gray-400 font-medium px-4">Localize sua entrega em tempo real informando seu WhatsApp ou o código do pedido.</p>
                    </div>
                    <OrderSearchForm onOrderFound={setOrder} />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <button onClick={() => setOrder(null)} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-all">
                      <ArrowLeft size={16} /> Voltar para busca
                    </button>
                    <div className="space-y-6">
                      <ClientTrackingDetails order={order} />
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'categories' && (
              <motion.div 
                key="categories"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-12"
              >
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-gray-900 tracking-tight italic">Nossas Categorias</h3>
                  <p className="text-gray-400 font-medium">Navegue por departamento e encontre o que precisa.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {categories.map(cat => (
                    <button 
                      key={cat.id}
                      onClick={() => { setSelectedCategory(cat.name); setActiveTab('shop'); }}
                      className={cn(
                        "group relative overflow-hidden bg-white p-10 rounded-[3rem] shadow-xl border border-gray-100 flex flex-col items-center text-center gap-6 transition-all hover:-translate-y-2 hover:shadow-2xl"
                      )}
                    >
                      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-[0.03] transition-opacity group-hover:opacity-[0.08]", cat.gradient)} />
                      <div className={cn("w-20 h-20 rounded-[2rem] flex items-center justify-center shadow-xl shadow-gray-100 transition-all group-hover:scale-110 group-hover:rotate-6", cat.color, "bg-white")}>
                        <cat.icon size={40} />
                      </div>
                      <div className="space-y-1 relative z-10">
                        <span className="text-xl font-black tracking-tight text-gray-900 italic">{cat.name}</span>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic group-hover:text-indigo-600 transition-colors">Explorar Coleção</p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'orders' && (
              <motion.div 
                key="orders"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-8"
              >
                <h3 className="text-3xl font-black text-gray-900 tracking-tight italic">Seus Pedidos</h3>
                <OrderHistory onTrack={(o) => { setOrder(o); setActiveTab('tracking'); }} />
              </motion.div>
            )}

            {activeTab === 'favorites' && (
              <motion.div 
                key="favorites"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-gray-900 tracking-tight italic">Seus Favoritos</h3>
                  <p className="text-gray-400 font-medium">Os produtos que você mais gosta, salvos aqui para facilitar sua compra.</p>
                </div>

                {favorites.length === 0 ? (
                  <div className="bg-white p-16 rounded-[3rem] shadow-xl border border-gray-100 text-center space-y-8">
                    <div className="w-24 h-24 bg-pink-50 rounded-3xl flex items-center justify-center mx-auto text-pink-500 shadow-inner">
                      <Heart size={48} />
                    </div>
                    <div className="space-y-2">
                       <h2 className="text-2xl font-black text-gray-900 tracking-tight italic">Sua lista está vazia</h2>
                       <p className="text-gray-400 font-medium text-sm">Explore nossa loja e clique no coração para salvar seus itens preferidos.</p>
                    </div>
                    <button 
                      onClick={() => setActiveTab('shop')}
                      className="bg-indigo-600 text-white px-10 py-5 rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all"
                    >
                      Explorar Produtos
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {featuredProducts.filter(p => favorites.includes(p.id)).map(product => (
                      <ProductCard 
                        key={product.id} 
                        product={product} 
                        onAdd={addToCart} 
                        onUpdateQuantity={updateQuantity}
                        onView={(p) => { setSelectedProduct(p); setActiveTab('product'); }} 
                        cartItems={cart} 
                        isFavorite={true} 
                        onToggleFavorite={toggleFavorite} 
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};

const ProductCard = ({ product, onAdd, onUpdateQuantity, onView, cartItems = [], isFavorite = false, onToggleFavorite }: { product: Product, onAdd: (p: Product) => void, onUpdateQuantity?: (id: string, delta: number) => void, onView: (p: Product) => void, cartItems?: CartItem[], isFavorite?: boolean, onToggleFavorite?: (id: string) => void, key?: any }) => {
  const cartItem = cartItems.find(item => item.id === product.id);
  const quantity = cartItem?.quantity || 0;

  return (
    <motion.div 
      whileHover={{ y: -5 }}
      className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 space-y-5 hover:shadow-2xl transition-all group relative overflow-hidden"
    >
      {product.originalPrice && (
        <div className="absolute top-4 left-4 z-10">
          <span className="bg-red-500 text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-lg shadow-sm">Oferta</span>
        </div>
      )}

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        {isFavorite && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(product.id); }}
            className="bg-white p-2 rounded-full shadow-md text-pink-500 border border-pink-50"
          >
            <Heart size={14} fill="currentColor" />
          </motion.button>
        )}
        
        {quantity > 0 && (
          <motion.div 
            key={quantity}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-emerald-500 text-white text-[10px] font-black px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 border-2 border-white"
          >
            <CheckCircle2 size={12} />
            {quantity} <span className="opacity-70 text-[8px]">und.</span>
          </motion.div>
        )}
      </div>

      <div 
        onClick={() => onView(product)}
        className="aspect-square bg-gray-50 rounded-3xl flex items-center justify-center overflow-hidden cursor-pointer relative group"
      >
        <img src={product.image} className="w-full h-full object-cover group-hover:scale-110 transition-all duration-500" alt={product.name} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <button className="bg-white text-gray-900 p-4 rounded-full shadow-2xl transform translate-y-4 group-hover:translate-y-0 transition-all">
            <Search size={20} />
          </button>
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{product.category}</p>
          {product.requiresApproval && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />}
        </div>
        <h4 
          onClick={() => onView(product)}
          className="font-bold text-gray-900 line-clamp-1 italic cursor-pointer hover:text-indigo-600 transition-colors"
        >
          {product.name}
        </h4>
      </div>
      <div className="flex justify-between items-center pt-2">
        <div className="flex flex-col">
          {product.originalPrice && <span className="text-[10px] text-gray-400 line-through font-bold">R$ {product.originalPrice.toFixed(2)}</span>}
          <span className="text-2xl font-black text-indigo-600 tracking-tight">R$ {product.price.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          {!isFavorite && (
             <motion.button
               whileTap={{ scale: 0.8 }}
               onClick={() => onToggleFavorite?.(product.id)}
               className="p-4 rounded-2xl bg-pink-50 text-pink-600 border border-pink-100 hover:bg-pink-100 shadow-sm"
             >
               <Heart size={20} />
             </motion.button>
          )}
          
          {quantity > 0 && onUpdateQuantity && (
            <motion.button 
              whileTap={{ scale: 0.85 }}
              onClick={() => onUpdateQuantity(product.id, -1)}
              className="p-4 rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all shadow-md active:scale-95"
            >
              <Minus size={20} />
            </motion.button>
          )}

          <motion.button 
            whileTap={{ scale: 0.85 }}
            onClick={() => onAdd(product)}
            className={cn(
              "p-4 rounded-2xl transition-all shadow-lg group/btn relative overflow-hidden",
              quantity > 0 ? "bg-emerald-500 hover:bg-emerald-600" : "bg-indigo-600 hover:bg-indigo-700"
            )}
          >
            <div className="relative z-10">
              {quantity > 0 ? (
                <div className="flex items-center gap-1 group-hover/btn:scale-110 transition-transform">
                  <Plus size={20} className="font-bold" />
                </div>
              ) : (
                <Plus size={20} className="group-hover/btn:rotate-90 transition-all" />
              )}
            </div>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

const CheckoutForm = ({ cart, total, onComplete, pixKey, pharmacyId = DEFAULT_PHARMACY_ID }: { cart: CartItem[], total: number, onComplete: (order: Order) => void, pixKey?: string, pharmacyId?: string }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    address: '',
    paymentMethod: 'pix' as PaymentMethod,
    deliveryType: 'normal' as DeliveryType,
    change: 0
  });
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Carrega dados salvos do usuário ao iniciar
  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        name: prev.name || user.name || '',
        phone: prev.phone || user.phone || '',
        address: prev.address || user.address || ''
      }));
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Clique no botão finalizar detectado");
    
    // Validação Manual para facilitar debug no Mobile
    if (!formData.name.trim()) { alert("Por favor, preencha o seu Nome."); return; }
    if (!formData.phone.trim()) { alert("Por favor, preencha o seu WhatsApp."); return; }
    if (!formData.address.trim()) { alert("Por favor, preencha o Endereço de Entrega."); return; }

    if (formData.paymentMethod === 'dinheiro' && formData.change > 0 && formData.change <= total) {
      alert("O valor para troco deve ser maior que o total do pedido.");
      return;
    }

    setIsSubmitting(true);
    
    if (!user) {
      alert("Sua sessão expirou ou você não está logado. Por favor, faça login novamente.");
      setIsSubmitting(false);
      return;
    }

    console.log("Iniciando transação para pedido sequencial...");
    
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Sessao invalida. Entre novamente.');

      const response = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pharmacyId,
          customerName: formData.name,
          customerAddress: formData.address,
          customerPhone: formData.phone,
          paymentMethod: formData.paymentMethod,
          deliveryType: formData.deliveryType,
          change: formData.paymentMethod === 'dinheiro' ? formData.change : 0,
          cart: cart.map(item => ({
            productId: item.id,
            quantity: item.quantity
          }))
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || 'Nao foi possivel finalizar o pedido.');
      }

      const orderSnap = await getDoc(doc(db, 'orders', result.orderId));
      if (!orderSnap.exists()) {
        throw new Error('Pedido criado, mas nao foi possivel carregar os dados.');
      }
      const orderData = { id: orderSnap.id, ...orderSnap.data() } as Order;

      console.log("Pedido finalizado com sucesso:", orderData.orderCode);
      
      // Salva os dados no perfil do usuário para a próxima vez
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          phone: formData.phone,
          address: formData.address,
          name: formData.name
        });
      } catch (e) {
        console.warn("Erro ao salvar dados do perfil:", e);
      }

      onComplete(orderData);
    } catch (error: any) {
      console.error("Erro na transação do pedido:", error);
      let errorMsg = "Não foi possível finalizar o pedido.";
      if (error?.code === 'permission-denied') {
        errorMsg += " Erro de permissão no banco de dados. Verifique as regras de segurança.";
      } else if (error?.message) {
        errorMsg += " Detalhes: " + error.message;
      }
      alert(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-2">Seu Nome</label>
          <input 
            type="text" 
            placeholder="Ex: João Silva"
            className="w-full bg-gray-50 border-2 border-gray-50 p-5 rounded-2xl font-bold focus:ring-4 focus:ring-indigo-50 outline-none transition-all"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-2">WhatsApp</label>
          <input 
            type="tel" 
            placeholder="(00) 00000-0000"
            className="w-full bg-gray-50 border-2 border-gray-50 p-5 rounded-2xl font-bold focus:ring-4 focus:ring-indigo-50 outline-none transition-all"
            value={formData.phone}
            onChange={e => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-2">Endereço de Entrega</label>
        <textarea 
          placeholder="Rua, número, complemento e bairro"
          className="w-full bg-gray-50 border-2 border-gray-50 p-5 rounded-2xl font-bold focus:ring-4 focus:ring-indigo-50 outline-none transition-all h-32 resize-none"
          value={formData.address}
          onChange={e => setFormData({ ...formData, address: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {paymentMethods.map(method => (
          <button 
            key={method}
            type="button"
            onClick={() => setFormData({ ...formData, paymentMethod: method, change: method === 'dinheiro' ? formData.change : 0 })}
            className={cn(
              "p-4 rounded-xl font-bold border-2 transition-all flex flex-col items-center gap-2",
              formData.paymentMethod === method ? "bg-indigo-600 border-indigo-600 text-white shadow-lg" : "bg-white border-gray-100 text-gray-500 hover:border-indigo-100"
            )}
          >
            <span className="uppercase text-[10px] tracking-widest">{paymentMethodLabels[method]}</span>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {formData.paymentMethod === 'convenio' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50 p-6 rounded-2xl border border-amber-100 space-y-2"
          >
            <div className="flex items-center gap-3 text-amber-700">
              <ShieldCheck size={24} />
              <h5 className="font-bold">Convênio / deixar na conta</h5>
            </div>
            <p className="text-sm text-amber-900/70 font-medium">
              A farmácia vai conferir no sistema interno se este cliente possui convênio ou conta autorizada antes de aprovar o pedido.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {formData.paymentMethod === 'dinheiro' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 space-y-4"
          >
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 size={24} />
              <h5 className="font-bold">Pagamento em dinheiro</h5>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, change: 0 })}
                className={cn(
                  "h-12 rounded-xl border-2 text-sm font-black uppercase tracking-widest transition-all",
                  !formData.change ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-emerald-100 text-emerald-700"
                )}
              >
                Sem Troco
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, change: formData.change || Math.ceil(total / 10) * 10 })}
                className={cn(
                  "h-12 rounded-xl border-2 text-sm font-black uppercase tracking-widest transition-all",
                  formData.change ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-emerald-100 text-emerald-700"
                )}
              >
                Precisa Troco
              </button>
            </div>
            {Boolean(formData.change) && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest pl-1">Troco para quanto?</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full bg-white border-2 border-emerald-100 p-4 rounded-2xl font-black text-emerald-700 focus:ring-4 focus:ring-emerald-100 outline-none"
                  value={formData.change || ''}
                  onChange={e => setFormData({ ...formData, change: parseFloat(e.target.value) || 0 })}
                  placeholder="Ex: 100,00"
                />
                <p className="text-sm font-bold text-emerald-700">
                  A farmácia deve levar R$ {money(Math.max(Number(formData.change || 0) - total, 0))} de troco.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {formData.paymentMethod === 'pix' && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 space-y-3"
          >
            <div className="flex items-center gap-3 text-indigo-600">
              <QrCode size={24} />
              <h5 className="font-bold">Pagamento via PIX</h5>
            </div>
            <p className="text-sm text-indigo-900/70 font-medium">
              Realize o pagamento para a chave abaixo e anexe o comprovante ou mostre ao entregador.
            </p>
            <div className="bg-white p-4 rounded-xl border border-indigo-100 flex items-center justify-between">
              <span className="font-mono font-bold text-indigo-600 truncate">{pixKey || 'Chave não cadastrada'}</span>
              <button 
                type="button"
                onClick={() => { navigator.clipboard.writeText(pixKey || ''); alert('Chave PIX copiada!'); }}
                className="text-[10px] font-black uppercase tracking-widest bg-indigo-600 text-white px-3 py-1.5 rounded-lg shadow-sm"
              >
                Copiar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button 
        type="submit"
        disabled={isSubmitting}
        className={cn(
          "w-full bg-emerald-600 text-white h-20 rounded-full font-black uppercase tracking-widest italic shadow-xl shadow-emerald-100 hover:bg-emerald-700 active:scale-[0.98] transition-all flex items-center justify-center gap-4 text-lg px-8",
          isSubmitting && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 size={28} className={cn("shrink-0", isSubmitting && "animate-bounce")} />
          <span className="text-center">
            {isSubmitting ? 'Processando...' : `Concluir e Enviar Pedido • R$ ${total.toFixed(2)}`}
          </span>
        </div>
      </button>
    </form>
  );
};

const ProductAccordionItem = ({ title, content }: { title: string, content: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-4 flex items-center justify-between group transition-all"
      >
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-indigo-600">{title}</span>
        <Plus size={16} className={cn("text-gray-300 transition-transform", isOpen && "rotate-45 text-indigo-600")} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <p className="text-sm text-gray-500 font-medium leading-relaxed pb-6 pr-4 whitespace-pre-line">
              {content}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const OrderHistory = ({ onTrack }: { onTrack: (o: Order) => void }) => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    // Removendo o orderBy da query do Firestore para evitar a necessidade de criar um índice composto manualmente agora.
    // Ordenaremos na memória para garantir que funcione imediatamente.
    const q = query(
      collection(db, 'orders'), 
      where('customerId', '==', user.uid),
      limit(50)
    );
    
    const unsub = onSnapshot(q, (snap) => {
      const fetchedOrders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as any } as Order));
      // Ordenação manual por data decrescente
      fetchedOrders.sort((a, b) => {
        const timeA = a.createdAt?.toMillis?.() || 0;
        const timeB = b.createdAt?.toMillis?.() || 0;
        return timeB - timeA;
      });
      setOrders(fetchedOrders);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao carregar histórico:", error);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  if (loading) return <div className="text-center p-12 text-gray-400">Carregando...</div>;

  return (
    <div className="space-y-4">
      {orders.map(order => (
        <div key={order.id} className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 hover:shadow-xl transition-all">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4 md:gap-6 min-w-0">
              <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center text-indigo-600 shrink-0">
                <Package size={24} />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-bold text-gray-900 italic truncate">Pedido #{order.orderCode}</h4>
                  <StatusBadge status={order.status} />
                </div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest truncate">{order.items}</p>
              </div>
            </div>
            <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-4 md:pt-0 border-gray-50">
              <div className="text-right">
                <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest mb-1">Total</p>
                <p className="font-black text-gray-900 whitespace-nowrap">R$ {order.totalValue?.toFixed(2)}</p>
              </div>
              <button 
                onClick={() => onTrack(order)}
                className="bg-indigo-50 text-indigo-600 px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
              >
                Rastrear
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const OrderSearchForm = ({ onOrderFound }: { onOrderFound: (order: Order) => void }) => {
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput) return;
    setLoading(true);
    try {
      const cleanInput = searchInput.replace(/\D/g, '');
      let q;
      if (cleanInput.length === 4) {
        q = query(collection(db, 'orders'), where('orderCode', '==', cleanInput));
      } else {
        q = query(collection(db, 'orders'), where('customerPhone', '>=', cleanInput), limit(10));
      }
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        let foundDoc = snapshot.docs[0];
        if (cleanInput.length > 4) {
          const matchingDocs = snapshot.docs.filter(doc => {
            const data = doc.data() as Order;
            const phone = data.customerPhone.replace(/\D/g, '');
            return phone.endsWith(cleanInput.slice(-8));
          });
          if (matchingDocs.length > 0) foundDoc = matchingDocs[0];
          else { alert('Pedido não encontrado.'); setLoading(false); return; }
        }
        onOrderFound({ id: foundDoc.id, ...foundDoc.data() as any } as Order);
      } else {
        alert('Pedido não encontrado.');
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSearch} className="flex flex-col gap-4 max-w-sm mx-auto">
      <div className="relative group">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={24} />
        <input 
          type="text" 
          placeholder="WhatsApp ou Código #"
          className="w-full pl-14 pr-6 py-5 bg-gray-50 border border-gray-100 rounded-[2rem] font-bold focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-lg"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          required
        />
      </div>
      <button 
        type="submit"
        disabled={loading}
        className="w-full bg-indigo-600 text-white py-5 rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all disabled:opacity-50"
      >
        {loading ? 'Buscando...' : 'Acompanhar Entrega'}
      </button>
    </form>
  );
};

const ClientTrackingDetails = ({ order: initialOrder }: { order: Order }) => {
  const [order, setOrder] = useState<Order>(initialOrder);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'orders', order.id), (doc) => {
      if (doc.exists()) {
        setOrder({ id: doc.id, ...doc.data() as any } as Order);
      }
    });
    return () => unsub();
  }, [order.id]);

  return (
    <div className="space-y-6">
      <div className="bg-emerald-600 text-white p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center shadow-inner">
              <Package size={32} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight italic">FarmaLog</h2>
              <p className="text-sm font-medium opacity-80">Monitoramento Ativo</p>
            </div>
          </div>
          <div className="bg-white/20 backdrop-blur-md px-6 py-2 rounded-2xl text-lg font-black shadow-sm border border-white/10 italic">
            Pedido #{order.orderCode}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 tracking-tight italic">Status da Entrega</h3>
              <StatusBadge status={order.status} />
            </div>
            <div className="p-10 bg-gray-50/30 border-b border-gray-50">
              <DeliveryProgress order={order} />
            </div>
            <div className="p-8">
              <ClientTrackingMap order={order} />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 p-8 space-y-6">
            <h4 className="text-lg font-black text-gray-900 tracking-tight italic">Informações</h4>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                  <UserIcon size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cliente</p>
                  <p className="font-bold text-gray-900">{order.customerName}</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
                  <Bike size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Entregador</p>
                  <p className="font-bold text-gray-900">{order.motoboyName || 'Aguardando...'}</p>
                </div>
              </div>
            </div>
            {order.status === 'delivered' && (
              <div className="pt-4 border-t border-gray-100 space-y-4">
                <h5 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest italic">Comprovante de Entrega</h5>
                <img 
                  src={order.deliveryProof?.photoUrl || `https://picsum.photos/seed/${order.id}/400/300`} 
                  className="w-full h-40 object-cover rounded-2xl border-2 border-gray-50 shadow-inner" 
                  alt="Proof" 
                  referrerPolicy="no-referrer"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---
const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const syncedClaimsRef = useRef<Set<string>>(new Set());

  const syncAuthClaims = async (firebaseUser: FirebaseUser) => {
    const idToken = await firebaseUser.getIdToken();
    const response = await fetch('/api/sync-claims', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error || 'Nao foi possivel sincronizar permissoes.');
    }

    const result = await response.json();
    if (result?.claimsUpdated) {
      await firebaseUser.getIdToken(true);
    }
  };

  const completeGoogleSignIn = async (firebaseUser: FirebaseUser, requestedRole?: AppUser['role']) => {
    const isAdminEmail = firebaseUser.email === 'xtiaguinhox65@gmail.com';
    const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
    
    if (!userDoc.exists()) {
      const newUser: AppUser = {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || 'Usuário',
        email: firebaseUser.email || '',
        role: isAdminEmail ? 'admin' : (requestedRole || 'client'),
        photoURL: firebaseUser.photoURL || '',
        status: (requestedRole === 'motoboy' && !isAdminEmail) ? 'available' : undefined,
        pharmacyId: getInitialPharmacyId(firebaseUser.uid, requestedRole, isAdminEmail)
      };
      await setDoc(doc(db, 'users', firebaseUser.uid), newUser, { merge: true });
      await syncAuthClaims(firebaseUser);
      storeGoogleLoginRole();
      return;
    }

    const existingUser = userDoc.data() as AppUser;
    
    if (isAdminEmail) {
      if (existingUser.role !== 'admin') {
        await updateDoc(doc(db, 'users', firebaseUser.uid), { role: 'admin' });
      }
      await syncAuthClaims(firebaseUser);
      storeGoogleLoginRole();
      return;
    }

    if (requestedRole && existingUser.role !== requestedRole) {
      await signOut(auth);
      storeGoogleLoginRole();
      throw new Error(`Este e-mail já está cadastrado como ${existingUser.role}. Por favor, entre no setor correto.`);
    }

    await syncAuthClaims(firebaseUser);
    storeGoogleLoginRole();
  };

  useEffect(() => {
    let unsubUser: (() => void) | undefined;

    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          await completeGoogleSignIn(result.user, getStoredGoogleLoginRole());
        }
      })
      .catch((error) => {
        console.error('Erro ao finalizar login com Google:', error);
        storeGoogleLoginRole();
      });

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Check if it's the admin email
        const isAdminEmail = firebaseUser.email === 'xtiaguinhox65@gmail.com';
        const requestedRole = getStoredGoogleLoginRole();
        
        unsubUser = onSnapshot(doc(db, 'users', firebaseUser.uid), (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data() as AppUser;
            if (!syncedClaimsRef.current.has(firebaseUser.uid)) {
              syncedClaimsRef.current.add(firebaseUser.uid);
              void syncAuthClaims(firebaseUser).catch(error => {
                console.error('Erro ao sincronizar permissoes:', error);
              });
            }
            // Force admin role if email matches
            if (isAdminEmail && userData.role !== 'admin') {
              const updatedAdmin = { ...userData, role: 'admin' as const };
              updateDoc(doc(db, 'users', firebaseUser.uid), { role: 'admin' });
              setUser(updatedAdmin);
            } else {
              setUser(userData);
            }
          } else {
            // Default to client or admin if email matches
            const newUser: AppUser = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || 'Usuário',
              email: firebaseUser.email || '',
              role: isAdminEmail ? 'admin' : (requestedRole || 'client'),
              photoURL: firebaseUser.photoURL || '',
              pharmacyId: getInitialPharmacyId(firebaseUser.uid, requestedRole, isAdminEmail)
            };
            const createUserDoc = setDoc(doc(db, 'users', firebaseUser.uid), newUser, { merge: true });
            if (!syncedClaimsRef.current.has(firebaseUser.uid)) {
              syncedClaimsRef.current.add(firebaseUser.uid);
              void createUserDoc
                .then(() => syncAuthClaims(firebaseUser))
                .catch(error => {
                  console.error('Erro ao sincronizar permissoes:', error);
                });
            }
            setUser(newUser);
          }
          setLoading(false);
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
          setLoading(false);
        });
      } else {
        if (unsubUser) {
          unsubUser();
          unsubUser = undefined;
        }
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubUser) unsubUser();
    };
  }, []);

  const signIn = async (requestedRole?: AppUser['role']) => {
    const provider = new GoogleAuthProvider();
    storeGoogleLoginRole(requestedRole);

    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        await completeGoogleSignIn(result.user, requestedRole);
      }
    } catch (error: any) {
      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/popup-closed-by-user') {
        await signInWithRedirect(auth, provider);
        return;
      }
      storeGoogleLoginRole();
      throw error;
    }
    return;

    const result = await signInWithPopup(auth, provider);
    
    if (result.user) {
      const isAdminEmail = result.user.email === 'xtiaguinhox65@gmail.com';
      const userDoc = await getDoc(doc(db, 'users', result.user.uid));
      
      if (!userDoc.exists()) {
        const newUser: AppUser = {
          uid: result.user.uid,
          name: result.user.displayName || 'Usuário',
          email: result.user.email || '',
          role: isAdminEmail ? 'admin' : (requestedRole || 'client'),
          photoURL: result.user.photoURL || '',
          status: (requestedRole === 'motoboy' && !isAdminEmail) ? 'available' : undefined
        };
        await setDoc(doc(db, 'users', result.user.uid), newUser, { merge: true });
      } else {
        const existingUser = userDoc.data() as AppUser;
        
        // If it's the admin email, we don't care about the requested role, they are admin
        if (isAdminEmail) {
          if (existingUser.role !== 'admin') {
            await updateDoc(doc(db, 'users', result.user.uid), { role: 'admin' });
          }
          return;
        }

        if (requestedRole && existingUser.role !== requestedRole) {
          await signOut(auth);
          throw new Error(`Este e-mail já está cadastrado como ${existingUser.role}. Por favor, entre no setor correto.`);
        }
      }
    }
  };

  const signInWithEmail = async (email: string, pass: string, requestedRole?: AppUser['role']) => {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    if (result.user && requestedRole) {
      const userDoc = await getDoc(doc(db, 'users', result.user.uid));
      if (userDoc.exists()) {
        const existingUser = userDoc.data() as AppUser;
        if (existingUser.role !== requestedRole && existingUser.role !== 'admin') {
          await signOut(auth);
          throw new Error(`Este e-mail já está cadastrado como ${existingUser.role}.`);
        }
      }
    }
  };

  const signUpWithEmail = async (email: string, pass: string, name: string, role: AppUser['role'], pharmacyData?: PharmacySignupData) => {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(result.user, { displayName: name });
    const pharmacyId = getInitialPharmacyId(result.user.uid, role);
    const newUser: AppUser = {
      uid: result.user.uid,
      name,
      email,
      role,
      photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${result.user.uid}`,
      status: role === 'motoboy' ? 'available' : undefined,
      pharmacyId
    };
    await setDoc(doc(db, 'users', result.user.uid), newUser, { merge: true });
    if (role === 'pharmacist') {
      await setDoc(
        doc(db, 'pharmacies', pharmacyId),
        {
          ...getDefaultPharmacyProfile(pharmacyId, result.user.uid, pharmacyData),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const updateUserProfile = async (data: { name?: string, photoURL?: string }) => {
    if (!auth.currentUser) return;
    await updateProfile(auth.currentUser, {
      displayName: data.name || auth.currentUser.displayName,
      photoURL: data.photoURL || auth.currentUser.photoURL
    });
    await updateDoc(doc(db, 'users', auth.currentUser.uid), data);
  };

  const updateUserPassword = async (newPass: string) => {
    if (!auth.currentUser) return;
    await updatePassword(auth.currentUser, newPass);
  };


  const logout = async () => {
    await signOut(auth);
    localStorage.removeItem('farma_admin');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ 
      user, loading, signIn, signInWithEmail, signUpWithEmail, 
      resetPassword,
      updateUserProfile, updateUserPassword, logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

const SettingsView = () => {
  const { user, updateUserProfile, updateUserPassword, resetPassword } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [photoURL, setPhotoURL] = useState(user?.photoURL || '');
  const [newPass, setNewPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const avatars = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Max',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Oliver',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Maya',
  ];

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateUserProfile({ name, photoURL });
      setMessage({ type: 'success', text: 'Perfil atualizado com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPass) return;
    setLoading(true);
    try {
      await updateUserPassword(newPass);
      setNewPass('');
      setMessage({ type: 'success', text: 'Senha atualizada com sucesso!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Erro ao atualizar senha. Tente sair e entrar novamente.' });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      await resetPassword(user.email);
      setMessage({ type: 'success', text: 'E-mail de recuperação enviado!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-black text-gray-900 tracking-tight">Configurações da Conta</h2>
      </div>

      {message && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "p-4 rounded-2xl text-sm font-medium border",
            message.type === 'success' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-600 border-red-100"
          )}
        >
          {message.text}
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Profile Section */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-6">
          <div className="flex items-center gap-4 text-indigo-600">
            <UserIcon size={24} />
            <h3 className="text-xl font-bold text-gray-900">Perfil</h3>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden border-4 border-white shadow-lg">
                <img src={photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default'} alt="" referrerPolicy="no-referrer" />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {avatars.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPhotoURL(url)}
                    className={cn(
                      "w-10 h-10 rounded-full overflow-hidden border-2 transition-all",
                      photoURL === url ? "border-indigo-600 scale-110" : "border-transparent hover:scale-105"
                    )}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold text-gray-700 ml-1">Nome Completo</label>
                <input 
                  type="text" 
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 ml-1">URL da Foto (Opcional)</label>
                <input 
                  type="text" 
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={photoURL}
                  onChange={e => setPhotoURL(e.target.value)}
                  placeholder="https://exemplo.com/foto.jpg"
                />
              </div>
            </div>

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              Salvar Alterações
            </button>
          </form>
        </div>

        {/* Security Section */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 space-y-6">
          <div className="flex items-center gap-4 text-indigo-600">
            <Shield size={24} />
            <h3 className="text-xl font-bold text-gray-900">Segurança</h3>
          </div>

          <div className="space-y-8">
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="text-sm font-bold text-gray-700 ml-1">Nova Senha</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input 
                    type="password" 
                    className="w-full p-4 pl-12 bg-gray-50 border border-gray-100 rounded-2xl mt-1 focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={newPass}
                    onChange={e => setNewPass(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
              </div>
              <button 
                type="submit"
                disabled={loading || newPass.length < 6}
                className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-black transition-all disabled:opacity-50"
              >
                Atualizar Senha
              </button>
            </form>

            <div className="pt-6 border-t border-gray-100">
              <p className="text-sm text-gray-500 mb-4 font-medium">Esqueceu sua senha ou quer redefinir via e-mail?</p>
              <button 
                onClick={handleResetPassword}
                disabled={loading || !user?.email}
                className="w-full bg-white text-indigo-600 border-2 border-indigo-600 py-4 rounded-2xl font-bold hover:bg-indigo-50 transition-all disabled:opacity-50"
              >
                Enviar E-mail de Recuperação
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Dashboard = ({ portal }: { portal: 'cliente' | 'farmacia' | 'motoboy' }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('farmaentrega_cart');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [cartBump, setCartBump] = useState(false);
  const prevOrdersCount = useRef<number | null>(null);

  // Som global de novos pedidos (toca uma vez por novo pedido, independente da aba)
  useEffect(() => {
    if (portal !== 'farmacia') return;
    const q = query(collection(db, 'orders'), where('pharmacyId', '==', getPharmacyId(user)), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => {
      if (prevOrdersCount.current !== null && snap.size > prevOrdersCount.current) {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.play().catch(() => {});
      }
      prevOrdersCount.current = snap.size;
    });
    return () => unsub();
  }, [portal, user]);

  useEffect(() => {
    localStorage.setItem('farmaentrega_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (cart.length > 0) {
      setCartBump(true);
      const timer = setTimeout(() => setCartBump(false), 300);
      return () => clearTimeout(timer);
    }
  }, [cart.length, cart.reduce((acc, curr) => acc + curr.quantity, 0)]);

  const getInitialRole = () => {
    if (user?.role === 'admin') {
      if (portal === 'cliente') return 'client';
      if (portal === 'motoboy') return 'motoboy';
      return 'pharmacist';
    }
    return user?.role || 'client';
  };

  const [activeRole, setActiveRole] = useState<AppUser['role'] | 'admin' | 'settings'>(getInitialRole());
  const lastActiveRole = useRef<AppUser['role'] | 'admin'>(getInitialRole() as any);

  useEffect(() => {
    if (activeRole !== 'settings') {
      lastActiveRole.current = activeRole as any;
    }
  }, [activeRole]);

  const roleLabels = {
    pharmacist: 'Administrador da Farmácia',
    logistics: 'Logística de Entrega',
    motoboy: 'App Motoboy',
    client: 'Loja do Cliente',
    admin: 'Central de Comando',
    settings: 'Privacidade e Conta',
    catalog: 'Catálogo'
  };

  const portalIcons = {
    cliente: ShoppingCart,
    farmacia: Store,
    motoboy: Smartphone
  };

  const PortalIcon = portalIcons[portal];

  const sidebarVisibleRoles = () => {
    if (user?.role === 'admin' && portal === 'farmacia') {
       return [
    { id: 'pharmacist', label: 'Administrador da Farmácia', icon: Stethoscope },
         { id: 'logistics', label: 'Expedição Logística', icon: Box },
         { id: 'catalog', label: 'Gerenciar Catálogo', icon: Package },
       ];
    }
    if (activeRole === 'client') {
      return [
        { id: 'shop', label: 'Início da Loja', icon: Home },
        { id: 'categories', label: 'Departamentos', icon: LayoutDashboard },
        { id: 'cart', label: 'Meu Carrinho', icon: ShoppingCart },
        { id: 'favorites', label: 'Favoritos', icon: Heart },
        { id: 'orders', label: 'Meus Pedidos', icon: History },
      ];
    }
    return [];
  };

  const availableRoles = sidebarVisibleRoles();
  const [storeTab, setStoreTab] = useState<any>('shop');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row overflow-x-hidden">
       {/* Mobile Header */}
       <header className={cn(
         "md:hidden bg-white border-b border-gray-100 p-4 sticky top-0 z-50 flex items-center justify-between shadow-sm",
         activeRole === 'client' && "bg-indigo-600 border-indigo-500"
       )}>
         <button onClick={() => navigate('/')} className="flex items-center gap-2">
           <div className={cn(
             "p-1.5 bg-indigo-600 rounded-lg text-white shadow-lg shadow-indigo-100",
             activeRole === 'client' && "bg-white text-indigo-600"
           )}>
             <PortalIcon size={20} />
           </div>
           <h1 className={cn("text-lg font-black tracking-tight italic", activeRole === 'client' ? "text-white" : "text-gray-900")}>
             Farma<span className={activeRole === 'client' ? "text-indigo-200" : "text-indigo-600"}>Entrega</span>
           </h1>
         </button>
         
         <div className="flex items-center gap-2">
           {activeRole === 'client' && (
              <motion.button 
                animate={cartBump ? { scale: [1, 1.3, 1], rotate: [0, -10, 10, 0] } : {}}
                onClick={() => { setStoreTab('cart'); setIsMenuOpen(false); }} 
                className="relative p-2 text-white bg-white/10 rounded-xl"
              >
                <ShoppingCart size={20} />
                {cart.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center border border-indigo-600">
                    {cart.reduce((acc, c) => acc + c.quantity, 0)}
                  </span>
                )}
              </motion.button>
            )}
           <button 
             onClick={() => setIsMenuOpen(!isMenuOpen)}
             className={cn(
               "p-2 rounded-xl transition-colors",
               activeRole === 'client' ? "text-white hover:bg-white/10" : "text-gray-600 hover:bg-gray-50"
             )}
           >
             {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
           </button>
         </div>
       </header>

       {/* Overlay for mobile menu */}
       <AnimatePresence>
         {isMenuOpen && (
           <motion.div 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             onClick={() => setIsMenuOpen(false)}
             className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
           />
         )}
       </AnimatePresence>

       {/* Sidebar */}
       <aside className={cn(
         "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-100 flex flex-col shadow-2xl transition-transform duration-300 transform md:sticky md:top-0 md:translate-x-0 md:shadow-sm md:h-screen",
         isMenuOpen ? "translate-x-0" : "-translate-x-full"
       )}>
         <div className="p-8 border-b border-gray-50">
           <button onClick={() => { navigate('/'); setIsMenuOpen(false); }} className="flex items-center gap-3 group">
             <div className="p-2 bg-indigo-600 rounded-xl group-hover:rotate-12 transition-transform shadow-lg shadow-indigo-100 text-white">
               <PortalIcon size={24} />
             </div>
             <div>
               <h1 className="text-xl font-black text-gray-900 tracking-tight italic">Farma<span className="text-indigo-600">Entrega</span></h1>
               <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mt-0.5">{portal}</p>
             </div>
           </button>
         </div>

         <nav className="flex-1 p-6 space-y-2 overflow-y-auto">
           {activeRole === 'client' ? (
             <div className="space-y-6">
                <div className="space-y-1">
                  <div className="px-3 pb-2 text-[8px] font-black text-gray-300 uppercase tracking-[0.3em]">Navegação Loja</div>
                  {availableRoles.slice(0, 4).map(role => (
                    <button
                      key={role.id}
                      onClick={() => { setStoreTab(role.id as any); setIsMenuOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all",
                        storeTab === role.id 
                          ? "bg-indigo-600 text-white shadow-xl shadow-indigo-100" 
                          : "text-gray-400 hover:bg-gray-50 hover:text-gray-900"
                      )}
                    >
                      <motion.div
                        animate={storeTab === role.id && role.id === 'cart' && cartBump ? { scale: [1, 1.2, 1] } : {}}
                      >
                        <role.icon size={18} />
                      </motion.div>
                      {role.label}
                      {role.id === 'cart' && cart.length > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">
                          {cart.reduce((acc, c) => acc + c.quantity, 0)}
                        </span>
                      )}
                      {storeTab === role.id && <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full" />}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="px-3 pb-2 text-[8px] font-black text-gray-300 uppercase tracking-[0.3em]">Meus Pedidos</div>
                  {availableRoles.slice(4).map(role => (
                    <button
                      key={role.id}
                      onClick={() => { setStoreTab(role.id as any); setIsMenuOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all",
                        storeTab === role.id 
                          ? "bg-indigo-600 text-white shadow-xl shadow-indigo-100" 
                          : "text-gray-400 hover:bg-gray-50 hover:text-gray-900"
                      )}
                    >
                      <motion.div
                        animate={storeTab === role.id && role.id === 'cart' && cartBump ? { scale: [1, 1.2, 1] } : {}}
                      >
                        <role.icon size={18} />
                      </motion.div>
                      {role.label}
                      {role.id === 'cart' && cart.length > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">
                          {cart.reduce((acc, c) => acc + c.quantity, 0)}
                        </span>
                      )}
                      {storeTab === role.id && <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full" />}
                    </button>
                  ))}
                </div>
             </div>
           ) : (
             <>
               <div className="px-3 pb-3 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Painel de Controle</div>
               {availableRoles.length > 0 ? (
                 availableRoles.map(role => (
                   <button
                     key={role.id}
                     onClick={() => { setActiveRole(role.id as any); setIsMenuOpen(false); }}
                     className={cn(
                       "w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-sm font-bold transition-all",
                       activeRole === role.id 
                         ? "bg-indigo-600 text-white shadow-xl shadow-indigo-100" 
                         : "text-gray-400 hover:bg-gray-50 hover:text-gray-900"
                     )}
                   >
                     <role.icon size={20} /> {role.label}
                   </button>
                 ))
               ) : (
                  <button
                    onClick={() => setIsMenuOpen(false)}
                    className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-sm font-bold bg-indigo-50 text-indigo-600 border border-indigo-100 text-left"
                  >
                    <div className="p-1.5 bg-white rounded-lg shadow-sm">
                      {activeRole === 'pharmacist' && <Stethoscope size={16} />}
                      {activeRole === 'logistics' && <Box size={16} />}
                      {activeRole === 'motoboy' && <Smartphone size={16} />}
                      {activeRole === 'client' && <ShoppingCart size={16} />}
                    </div>
                    {roleLabels[activeRole as keyof typeof roleLabels]}
                  </button>
               )}
             </>
           )}

           <div className="pt-4 mt-6 border-t border-gray-50">
             <button
               onClick={() => { setActiveRole('settings'); setIsMenuOpen(false); }}
               className={cn(
                 "w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-sm font-bold transition-all",
                 activeRole === 'settings'
                   ? "bg-indigo-600 text-white shadow-xl shadow-indigo-100" 
                   : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
               )}
             >
               <SettingsIcon size={20} /> Ajustes da Conta
             </button>
           </div>
         </nav>

         <div className="p-6 bg-gray-50/50 mt-auto border-t border-gray-50">
            <div className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 overflow-hidden flex items-center justify-center">
                {user?.photoURL ? (
                  <img src={user.photoURL} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" />
                ) : (
                  <UserCircle size={24} className="text-indigo-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-gray-900 truncate">{user?.name}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase truncate italic">{user?.role}</p>
              </div>
            </div>
            
            <button 
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
            >
              <LogOut size={16} /> Encerrar Sessão
            </button>
         </div>
       </aside>

       <main className="flex-1 bg-gray-50 min-h-screen">
          <div className={cn("mx-auto", activeRole === 'client' ? "max-w-full" : "p-4 md:p-12 max-w-7xl")}>
             <AnimatePresence mode="wait">
               <motion.div
                 key={activeRole}
                 initial={{ opacity: 0, y: 10 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0 }}
                 transition={{ duration: 0.2 }}
               >
                 {activeRole === 'pharmacist' && <PharmacistView />}
                 {activeRole === 'logistics' && <LogisticsView />}
                 {activeRole === 'catalog' && <CatalogView />}
                 {activeRole === 'motoboy' && <MotoboyView />}
                 {activeRole === 'client' && (
                   <ClientView 
                     initialTab={storeTab} 
                     cartState={[cart, setCart]} 
                     cartBump={cartBump} 
                   />
                 )}
                 {activeRole === 'settings' && (
                   <div className="space-y-6 p-4 md:p-12">
                     <button 
                       onClick={() => setActiveRole(lastActiveRole.current)}
                       className="flex items-center gap-2 text-gray-400 hover:text-indigo-600 transition-colors font-bold text-sm"
                     >
                       <ArrowLeft size={18} /> Voltar ao Painel
                     </button>
                     <SettingsView />
                   </div>
                 )}
               </motion.div>
             </AnimatePresence>
          </div>
       </main>
    </div>
  );
};

const Login = ({ portal }: { portal: 'cliente' | 'farmacia' | 'motoboy' }) => {
  const { signIn, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loginMethod, setLoginMethod] = useState<'google' | 'email'>('google');
  const [emailMode, setEmailMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [selectedRole, setSelectedRole] = useState<AppUser['role']>(
    portal === 'motoboy' ? 'motoboy' : portal === 'cliente' ? 'client' : 'pharmacist'
  );
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [pharmacySignup, setPharmacySignup] = useState<PharmacySignupData>({
    name: '',
    cnpj: '',
    openingHours: 'Segunda a sabado, 08:00 as 20:00'
  });
  
  const [loading, setLoading] = useState(false);

  const portalConfig = {
    cliente: {
      title: 'Portal do Cliente',
      subtitle: 'Acesse para gerenciar seus pedidos e rastreio.',
      icon: ShoppingCart,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50'
    },
    farmacia: {
      title: 'Painel da Farmácia',
      subtitle: 'Entrada exclusiva para equipe interna.',
      icon: Store,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50'
    },
    motoboy: {
      title: 'App do Motoboy',
      subtitle: 'Identifique-se para ver suas rotas de hoje.',
      icon: Bike,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50'
    }
  };

  const currentPortal = portalConfig[portal];

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setError(null);
      await signIn(selectedRole);
    } catch (err: any) {
      setError(err.message || 'Erro ao entrar com Google.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!isValidEmail(email)) {
      setError('Por favor, insira um e-mail válido.');
      setLoading(false);
      return;
    }

    try {
      if (emailMode === 'signin') {
        await signInWithEmail(email, password, selectedRole);
      } else if (emailMode === 'signup') {
        if (portal === 'farmacia') {
          if (!pharmacySignup.name.trim() || !pharmacySignup.cnpj.trim() || !pharmacySignup.openingHours.trim()) {
            setError('Preencha nome da farmacia, CNPJ e horarios.');
            setLoading(false);
            return;
          }
        }
        await signUpWithEmail(email, password, name, selectedRole, portal === 'farmacia' ? pharmacySignup : undefined);
      } else {
        await resetPassword(email);
        setError('E-mail de recuperação enviado!');
        setEmailMode('signin');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white p-8 md:p-12 rounded-[2.5rem] shadow-2xl max-w-2xl w-full text-center space-y-8 border border-gray-100 relative overflow-hidden"
      >
        <button 
          onClick={() => navigate('/')}
          className="absolute top-6 left-6 text-gray-400 hover:text-indigo-600 transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-widest"
        >
          <ArrowLeft size={16} /> Voltar para a Tela Inicial
        </button>

        <div className="space-y-4">
          <div className={cn("w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-lg", currentPortal.bgColor, currentPortal.color)}>
            <currentPortal.icon size={40} />
          </div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight italic">{currentPortal.title}</h1>
          <p className="text-gray-500 font-medium px-4 leading-relaxed">{currentPortal.subtitle}</p>
        </div>

        {/* Login Method Tabs */}
        <div className="flex bg-gray-100 p-1.5 rounded-2xl max-w-sm mx-auto">
          {(['google', 'email'] as const).map((method) => (
            <button 
              key={method}
              onClick={() => setLoginMethod(method as any)}
              className={cn(
                "flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all", 
                loginMethod === method ? "bg-white shadow-sm text-indigo-600" : "text-gray-400 hover:bg-white/50"
              )}
            >
              {method === 'google' ? 'Google' : 'E-mail'}
            </button>
          ))}
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "p-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border",
              error.includes('enviado') || error.includes('sucesso') ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-600 border-red-100"
            )}
          >
            {error}
          </motion.div>
        )}

        {loginMethod === 'google' && (
          <button 
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-4 bg-white border-2 border-gray-100 h-16 rounded-2xl font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50 group"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="" />
            <span className="text-gray-700 tracking-tight">Identificar-se com Conta Google</span>
          </button>
        )}

        {loginMethod === 'email' && (
          <form onSubmit={handleEmailAuth} className="space-y-4 text-left">
            {emailMode === 'signup' && (
              <div className="group">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Nome Completo</label>
                <div className="relative">
                  <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                  <input 
                    type="text" 
                    className="w-full p-4 pl-12 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Seu nome"
                    required
                  />
                </div>
              </div>
            )}
            {emailMode === 'signup' && portal === 'farmacia' && (
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <div>
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1 mb-1 block">Nome da Farmacia</label>
                  <input
                    type="text"
                    className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={pharmacySignup.name}
                    onChange={e => setPharmacySignup({ ...pharmacySignup, name: e.target.value })}
                    placeholder="Ex: Drogaria Central"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1 mb-1 block">CNPJ</label>
                  <input
                    type="text"
                    className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={pharmacySignup.cnpj}
                    onChange={e => setPharmacySignup({ ...pharmacySignup, cnpj: e.target.value })}
                    placeholder="00.000.000/0000-00"
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1 mb-1 block">Horarios de Funcionamento</label>
                  <input
                    type="text"
                    className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={pharmacySignup.openingHours}
                    onChange={e => setPharmacySignup({ ...pharmacySignup, openingHours: e.target.value })}
                    placeholder="Segunda a sabado, 08:00 as 20:00"
                    required
                  />
                </div>
              </div>
            )}
            <div className="group">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">E-mail Corporativo</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                <input 
                  type="email" 
                  className={cn(
                    "w-full p-4 pl-12 bg-gray-50 border rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all",
                    email && !isValidEmail(email) ? "border-red-300 focus:ring-red-500" : "border-gray-100"
                  )}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="exemplo@farmaentrega.com"
                  required
                />
              </div>
            </div>
            {emailMode !== 'reset' && (
              <div className="group">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">Código de Acesso</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                  <input 
                    type="password" 
                    className="w-full p-4 pl-12 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>
            )}
            
            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              {emailMode === 'signin' ? 'Efetuar Login' : emailMode === 'signup' ? 'Cadastrar Perfil' : 'Recuperar Acesso'}
            </button>

            <div className="flex justify-between px-2">
              <button 
                type="button"
                onClick={() => setEmailMode(emailMode === 'signin' ? 'signup' : 'signin')}
                className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:underline"
              >
                {emailMode === 'signin' ? 'Não possui acesso? Cadastre-se' : 'Já possui conta? Acessar'}
              </button>
              {emailMode === 'signin' && (
                <button 
                  type="button"
                  onClick={() => setEmailMode('reset')}
                  className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600"
                >
                  Esqueceu a senha?
                </button>
              )}
            </div>
          </form>
        )}

        <div className="pt-4 border-t border-gray-50">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-black italic">
            Segurança FarmaEntrega • Ambiente Protocolado
          </p>
        </div>
      </motion.div>
    </div>
  );
};


const CatalogView = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isEditingStore, setIsEditingStore] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [storeConfig, setStoreConfig] = useState<PharmacyProfile>(() => getDefaultPharmacyProfile(DEFAULT_PHARMACY_ID));
  const importInputRef = useRef<HTMLInputElement | null>(null);
  
  const initialForm = {
    name: '',
    price: 0,
    originalPrice: 0,
    stock: 0,
    category: 'Medicamentos',
    image: '',
    description: '',
    specifications: '',
    howToUse: '',
    tags: ''
  };
  const [formData, setFormData] = useState(initialForm);

  useEffect(() => {
    if (!user) return;
    const pharmacyId = getPharmacyId(user);
    const q = query(collection(db, 'products'), where('pharmacyId', '==', pharmacyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      docs.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(docs);
    }, (error) => {
      console.error("Erro no catalogo", error);
    });

    const pharmacyRef = doc(db, 'pharmacies', pharmacyId);
    getDoc(pharmacyRef).then(async snap => {
      if (snap.exists()) {
        setStoreConfig({ ...getDefaultPharmacyProfile(pharmacyId, user.uid), ...snap.data() } as PharmacyProfile);
        return;
      }

      const defaultProfile = getDefaultPharmacyProfile(pharmacyId, user.uid, { name: user.name, cnpj: '', openingHours: '' });
      setStoreConfig(defaultProfile);
      await setDoc(pharmacyRef, {
        ...defaultProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    return () => unsubscribe();
  }, [user]);

  const handleSaveStoreConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await setDoc(doc(db, 'pharmacies', getPharmacyId(user)), {
        ...storeConfig,
        pharmacyId: getPharmacyId(user),
        ownerId: storeConfig.ownerId || user.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setIsEditingStore(false);
      alert('Configurações da loja atualizadas com sucesso!');
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar configurações.');
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return alert("Por favor, preencha o Nome do Produto.");
    if (!formData.price || formData.price <= 0 || isNaN(formData.price)) return alert("Por favor, preencha um Preço válido.");
    if (!formData.description) return alert("Por favor, preencha a Descrição do produto.");
    if (!formData.image) {
      alert("Por favor, adicione uma foto para o produto clicando no botão de selecionar imagem!");
      return;
    }
    const dataToSave = {
      ...formData,
      tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      originalPrice: formData.originalPrice || null,
      pharmacyId: getPharmacyId(user)
    };

    try {
      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id), dataToSave);
      } else {
        await addDoc(collection(db, 'products'), dataToSave);
      }
      setIsAdding(false);
      setEditingProduct(null);
      setFormData(initialForm);
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar produto.');
    }
  };

  const deleteProduct = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este produto?')) return;
    try {
      await deleteDoc(doc(db, 'products', id));
    } catch (error) {
      console.error(error);
    }
  };

  const editProduct = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice || 0,
      stock: product.stock || 0,
      category: product.category,
      image: product.image,
      description: product.description,
      specifications: product.specifications || '',
      howToUse: product.howToUse || '',
      tags: product.tags ? product.tags.join(', ') : ''
    });
    setIsAdding(true);
  };

  const downloadCsv = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleExportProducts = () => {
    const rows = products.map(product => ({
      name: product.name,
      category: product.category,
      price: product.price,
      stock: product.stock || 0,
      description: product.description,
      specifications: product.specifications || '',
      howToUse: product.howToUse || '',
      tags: product.tags?.join('|') || '',
      image: product.image || ''
    }));
    downloadCsv(`estoque-${getPharmacyId(user)}.csv`, Papa.unparse(rows));
  };

  const handleDownloadTemplate = () => {
    downloadCsv('template-estoque-farmaentrega.csv', Papa.unparse([
      {
        name: 'Dipirona 500mg',
        category: 'Medicamentos',
        price: 5.5,
        stock: 50,
        description: 'Analgesico e antitermico',
        specifications: '',
        howToUse: '',
        tags: 'Oferta|Mais vendido',
        image: ''
      }
    ]));
  };

  const handleCopyStoreLink = async () => {
    const link = `${window.location.origin}/cliente?pharmacyId=${getPharmacyId(user)}`;
    await navigator.clipboard.writeText(link);
    alert('Link da loja copiado.');
  };

  const handleImportProducts = async (file?: File) => {
    if (!file || !user) return;

    try {
      const text = await file.text();
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: header => header.trim()
      });

      if (result.errors.length) {
        alert('Erro ao ler CSV. Confira se a primeira linha contem os nomes das colunas.');
        return;
      }

      const pharmacyId = getPharmacyId(user);
      let imported = 0;
      let updated = 0;

      for (const row of result.data) {
        const name = row.name?.trim();
        const price = Number(String(row.price || '').replace(',', '.'));
        if (!name || !price || Number.isNaN(price)) continue;

        const dataToSave = {
          name,
          category: row.category?.trim() || 'Medicamentos',
          price,
          stock: Number(row.stock || row.quantity || 0) || 0,
          description: row.description?.trim() || name,
          specifications: row.specifications?.trim() || '',
          howToUse: row.howToUse?.trim() || '',
          tags: row.tags ? row.tags.split('|').map(tag => tag.trim()).filter(Boolean) : [],
          image: row.image?.trim() || storeConfig.heroImage,
          pharmacyId,
          updatedAt: serverTimestamp()
        };

        const existing = await getDocs(query(
          collection(db, 'products'),
          where('pharmacyId', '==', pharmacyId),
          where('name', '==', name)
        ));

        if (existing.empty) {
          await addDoc(collection(db, 'products'), {
            ...dataToSave,
            createdAt: serverTimestamp()
          });
          imported++;
        } else {
          await updateDoc(doc(db, 'products', existing.docs[0].id), dataToSave);
          updated++;
        }
      }

      alert(`${imported} produtos importados e ${updated} produtos atualizados.`);
    } catch (error) {
      console.error(error);
      alert('Erro ao importar estoque.');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Gerenciar Catálogo</h2>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => handleImportProducts(e.target.files?.[0])}
          />
          <button
            onClick={handleDownloadTemplate}
            className="bg-white text-gray-600 px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-gray-50 transition-all border border-gray-100 font-bold"
          >
            <Download size={20} /> Template
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            className="bg-white text-emerald-600 px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-gray-50 transition-all border border-emerald-100 font-bold"
          >
            <Upload size={20} /> Importar CSV
          </button>
          <button
            onClick={handleExportProducts}
            className="bg-white text-gray-600 px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-gray-50 transition-all border border-gray-100 font-bold"
          >
            <Download size={20} /> Exportar Estoque
          </button>
          <button 
            onClick={() => setIsEditingStore(true)}
            className="bg-white text-indigo-600 px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-gray-50 transition-all border border-indigo-100 font-bold"
          >
            <LayoutDashboard size={20} /> Configurar Loja
          </button>
          <button
            onClick={handleCopyStoreLink}
            className="bg-gray-900 text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-gray-800 transition-all font-bold"
          >
            <LinkIcon size={20} /> Link da Loja
          </button>
          <button 
            onClick={() => { setFormData(initialForm); setEditingProduct(null); setIsAdding(true); }}
            className="bg-indigo-600 text-white px-6 py-3 rounded-2xl flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 font-bold whitespace-nowrap"
          >
            <Plus size={20} /> Novo Produto
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isEditingStore && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleSaveStoreConfig} className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100 mb-6 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black text-indigo-900 italic">Configurações da Loja</h3>
                <button type="button" onClick={() => setIsEditingStore(false)} className="text-indigo-400 hover:text-indigo-600">
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Nome da Farmacia</label>
                  <input required className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold" value={storeConfig.name} onChange={e => setStoreConfig({...storeConfig, name: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">CNPJ</label>
                  <input required className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold" value={storeConfig.cnpj} onChange={e => setStoreConfig({...storeConfig, cnpj: e.target.value})} placeholder="00.000.000/0000-00" />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Horarios de Funcionamento</label>
                  <input required className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold" value={storeConfig.openingHours} onChange={e => setStoreConfig({...storeConfig, openingHours: e.target.value})} placeholder="Segunda a sabado, 08:00 as 20:00" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Título da Loja</label>
                  <input required className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold" value={storeConfig.title} onChange={e => setStoreConfig({...storeConfig, title: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Tempo de Entrega</label>
                  <div className="flex gap-2">
                    {['30min', '50min', '70min'].map(time => (
                      <button
                        key={time}
                        type="button"
                        onClick={() => setStoreConfig({...storeConfig, deliveryTime: time})}
                        className={cn(
                          "flex-1 py-4 rounded-2xl font-bold transition-all border",
                          storeConfig.deliveryTime === time 
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100" 
                            : "bg-white text-gray-600 border-indigo-100 hover:bg-indigo-50"
                        )}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Chave PIX da Farmácia</label>
                  <input className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold" value={storeConfig.pixKey} onChange={e => setStoreConfig({...storeConfig, pixKey: e.target.value})} placeholder="CPF, CNPJ, E-mail ou Chave Aleatória" />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Texto de Boas-vindas</label>
                  <textarea required className="w-full p-4 bg-white border border-indigo-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-medium min-h-[80px]" value={storeConfig.description} onChange={e => setStoreConfig({...storeConfig, description: e.target.value})} placeholder="Use {time} para inserir o tempo de entrega automaticamente." />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Banner Principal (Imagem de fundo)</label>
                  <div className="mt-1 flex items-center gap-4">
                    <div className="w-32 h-16 rounded-xl overflow-hidden bg-white border border-indigo-100 shrink-0 shadow-sm">
                      <img src={storeConfig.heroImage} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                    <label className="flex-1 cursor-pointer bg-white border-2 border-dashed border-indigo-200 hover:border-indigo-400 rounded-2xl p-4 text-center transition-all">
                      <span className="text-sm font-bold text-indigo-600">Clique para selecionar foto do banner</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 2 * 1024 * 1024) {
                              alert("O banner é muito pesado! Use uma imagem de até 2MB.");
                              return;
                            }
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setStoreConfig({...storeConfig, heroImage: reader.result as string});
                            };
                            reader.readAsDataURL(file);
                          }
                        }} 
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button type="button" onClick={() => setIsEditingStore(false)} className="px-6 py-3 text-indigo-400 font-bold">Cancelar</button>
                <button type="submit" className="bg-indigo-600 text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-200">Salvar Alterações</button>
              </div>
            </form>
          </motion.div>
        )}
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleSaveProduct} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 mb-6 space-y-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">{editingProduct ? 'Editar Produto' : 'Novo Produto'}</h3>
                <button type="button" onClick={() => setIsAdding(false)} className="text-gray-400 hover:text-gray-600">
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nome do Produto</label>
                  <input className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Categoria</label>
                  <select className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    <option value="Medicamentos">Medicamentos</option>
                    <option value="Higiene">Higiene</option>
                    <option value="Mamãe & Bebê">Mamãe & Bebê</option>
                    <option value="Vitaminas">Vitaminas</option>
                    <option value="Beleza">Beleza</option>
                    <option value="Primeiros Socorros">Primeiros Socorros</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Preço Atual (R$)</label>
                  <input type="number" step="0.01" className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl" value={formData.price || ''} onChange={e => setFormData({...formData, price: parseFloat(e.target.value)})} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Estoque</label>
                  <input type="number" min="0" className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl" value={formData.stock || ''} onChange={e => setFormData({...formData, stock: parseInt(e.target.value) || 0})} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Preço Antigo / Riscado (R$) (Opcional)</label>
                  <input type="number" step="0.01" className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl" value={formData.originalPrice || ''} onChange={e => setFormData({...formData, originalPrice: parseFloat(e.target.value) || 0})} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Imagem do Produto</label>
                  <div className="mt-1 flex items-center gap-4">
                    {formData.image && (
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 shrink-0">
                        <img src={formData.image} alt="Preview" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer bg-gray-50 border-2 border-dashed border-gray-200 hover:border-indigo-400 hover:bg-white rounded-xl p-4 text-center transition-all">
                      <span className="text-sm font-bold text-gray-600">Clique para selecionar foto do seu celular/PC</span>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 1.5 * 1024 * 1024) {
                              alert("Essa foto é muito pesada! Tente enviar uma foto com menos de 1.5MB.");
                              return;
                            }
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setFormData({...formData, image: reader.result as string});
                            };
                            reader.readAsDataURL(file);
                          }
                        }} 
                      />
                    </label>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Descrição Comercial</label>
                  <textarea className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl min-h-[80px]" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Resumo atrativo do produto..." />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Especificações Técnicas</label>
                  <textarea className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl min-h-[120px]" value={formData.specifications} onChange={e => setFormData({...formData, specifications: e.target.value})} placeholder="Composição, princípios ativos, etc..." />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Como Usar / Posologia</label>
                  <textarea className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl min-h-[120px]" value={formData.howToUse} onChange={e => setFormData({...formData, howToUse: e.target.value})} placeholder="Instruções de uso..." />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Tags (separadas por vírgula)</label>
                  <input className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl" value={formData.tags} onChange={e => setFormData({...formData, tags: e.target.value})} placeholder="Ex: Oferta, Mais Vendido, Verão" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button type="button" onClick={() => setIsAdding(false)} className="px-6 py-3 text-gray-500 font-bold">Cancelar</button>
                <button type="submit" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold">Salvar Produto</button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map(product => (
          <div key={product.id} className="bg-white p-4 rounded-3xl shadow-sm border border-gray-50 flex flex-col gap-4">
            <div className="w-full h-40 bg-gray-50 rounded-2xl overflow-hidden">
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{product.category}</p>
              <h4 className="font-bold text-gray-900 leading-tight mb-2 line-clamp-2">{product.name}</h4>
              <p className="text-xs font-bold text-gray-400 mb-2">Estoque: {product.stock || 0}</p>
              <div className="flex items-center gap-2">
                <span className="text-indigo-600 font-black text-xl">R$ {product.price.toFixed(2)}</span>
                {product.originalPrice && <span className="text-gray-400 line-through text-sm">R$ {product.originalPrice.toFixed(2)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-4 border-t border-gray-50">
              <button onClick={() => editProduct(product)} className="flex-1 bg-gray-50 text-indigo-600 font-bold py-2 rounded-xl text-sm">Editar</button>
              <button onClick={() => deleteProduct(product.id)} className="w-10 h-10 bg-red-50 text-red-500 flex items-center justify-center rounded-xl hover:bg-red-100 transition-colors">
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
        {products.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <Package size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-xl font-bold text-gray-900">Nenhum produto cadastrado</h3>
            <p className="text-gray-500">Adicione produtos para que seus clientes possam comprar.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const demoOrders = [
  {
    id: 'demo-001',
    code: 'FE-1048',
    customer: 'Marina Costa',
    phone: '(11) 98842-1048',
    address: 'Rua das Acacias, 120',
    items: 'Dipirona 500mg, Soro fisiologico, Vitamina C',
    payment: 'Pix',
    delivery: 'Normal',
    status: 'Em rota',
    statusColor: 'emerald',
    motoboy: 'Tiago Garcia',
    total: 86.7
  },
  {
    id: 'demo-002',
    code: 'FE-1049',
    customer: 'Paulo Mendes',
    phone: '(11) 97721-4400',
    address: 'Av. Brasil, 845',
    items: 'Produto controlado aguardando aprovacao',
    payment: 'Convenio',
    delivery: 'Controlado',
    status: 'Aguardando aprovacao',
    statusColor: 'amber',
    motoboy: 'Nao atribuido',
    total: 142.9
  },
  {
    id: 'demo-003',
    code: 'FE-1050',
    customer: 'Ana Ribeiro',
    phone: '(11) 95510-3321',
    address: 'Travessa Central, 44',
    items: 'Fralda geriatrica, Lencos umedecidos',
    payment: 'Deixar na conta',
    delivery: 'Urgente',
    status: 'Preparando',
    statusColor: 'blue',
    motoboy: 'Nao atribuido',
    total: 219.4
  }
];

const DemoView = () => {
  const navigate = useNavigate();
  const [activeDemo, setActiveDemo] = useState<'farmacia' | 'cliente' | 'motoboy'>('farmacia');
  const statusStyles: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100'
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-gray-50 md:flex">
      <aside className="border-b border-gray-100 bg-white shadow-sm md:sticky md:top-0 md:h-screen md:w-72 md:shrink-0 md:border-b-0 md:border-r">
        <div className="border-b border-gray-50 p-6 md:p-8">
          <button onClick={() => navigate('/')} className="flex items-center gap-3 group">
            <div className="rounded-xl bg-indigo-600 p-2 text-white shadow-lg shadow-indigo-100 transition-transform group-hover:rotate-12">
              <Store size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black italic tracking-tight text-gray-900">Farma<span className="text-indigo-600">Entrega</span></h1>
              <p className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-indigo-400">modo demo</p>
            </div>
          </button>
        </div>

        <nav className="space-y-2 p-6">
          <div className="px-3 pb-2 text-[8px] font-black uppercase tracking-[0.3em] text-gray-300">Setores</div>
          {[
            { id: 'farmacia', label: 'Painel da Farmacia', icon: Store },
            { id: 'cliente', label: 'Loja do Cliente', icon: ShoppingCart },
            { id: 'motoboy', label: 'App Motoboy', icon: Bike }
          ].map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveDemo(item.id as typeof activeDemo)}
              className={cn(
                "flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 text-xs font-black uppercase tracking-widest transition-all",
                activeDemo === item.id ? "bg-indigo-600 text-white shadow-xl shadow-indigo-100" : "text-gray-400 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="hidden p-6 md:block">
          <div className="rounded-3xl border border-indigo-50 bg-indigo-50/50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Demonstracao</p>
            <p className="mt-2 text-xs font-bold leading-relaxed text-gray-500">
              Dados ficticios para apresentar o app sem login e sem alterar o Firebase.
            </p>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/90 px-5 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-400">Ambiente demonstrativo sem login</p>
              <h2 className="text-2xl font-black tracking-tight text-gray-900">
                {activeDemo === 'farmacia' ? 'Administrador da Farmacia' : activeDemo === 'cliente' ? 'Loja do Cliente' : 'App Motoboy'}
              </h2>
            </div>
            <button type="button" onClick={() => navigate('/')} className="inline-flex w-fit items-center gap-2 rounded-xl bg-gray-100 px-4 py-2 text-xs font-black uppercase tracking-widest text-gray-500 hover:bg-gray-200">
              <ArrowLeft size={16} />
              Voltar
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
        <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          Esta tela replica os setores principais com dados ficticios. Botoes e pedidos sao apenas demonstrativos.
        </div>
        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[
            ['Pedidos hoje', '18', Package, 'text-indigo-600'],
            ['Em rota', '5', Navigation, 'text-emerald-600'],
            ['Faturamento', 'R$ 2.846', Zap, 'text-amber-600'],
            ['Motoboys ativos', '4', Bike, 'text-blue-600']
          ].map(([label, value, Icon, color]) => (
            <div key={label as string} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label as string}</p>
                <Icon size={20} className={color as string} />
              </div>
              <p className="text-2xl font-black text-gray-900">{value as string}</p>
            </div>
          ))}
        </section>

        {activeDemo === 'farmacia' && (
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
            <div className="rounded-3xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 p-5">
                <h2 className="text-lg font-black text-gray-900">Painel da farmacia</h2>
                <p className="text-sm font-medium text-gray-500">Pedidos com pagamento, tipo de entrega, convenio e atribuicao de motoboy.</p>
              </div>
              <div className="divide-y divide-gray-100">
                {demoOrders.map(order => (
                  <div key={order.id} className="grid gap-4 p-5 lg:grid-cols-[120px_1fr_150px_140px] lg:items-center">
                    <div>
                      <p className="text-xs font-black text-indigo-600">#{order.code}</p>
                      <p className="text-[11px] font-bold uppercase text-gray-400">{order.delivery}</p>
                    </div>
                    <div>
                      <p className="font-black text-gray-900">{order.customer}</p>
                      <p className="text-sm text-gray-500">{order.items}</p>
                      <p className="mt-1 text-xs font-bold text-gray-400">{order.address} - {order.phone}</p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase text-gray-400">{order.payment}</p>
                      <p className="font-black text-gray-900">R$ {order.total.toFixed(2)}</p>
                    </div>
                    <span className={cn("rounded-full border px-3 py-1 text-center text-[10px] font-black uppercase", statusStyles[order.statusColor])}>
                      {order.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
                <h3 className="mb-4 font-black text-gray-900">Produtos exemplo</h3>
                {['Dipirona 500mg - estoque 42', 'Soro fisiologico - estoque 18', 'Produto controlado - exige aprovacao'].map(item => (
                  <div key={item} className="mb-3 rounded-2xl bg-gray-50 p-3 text-sm font-bold text-gray-600">{item}</div>
                ))}
              </div>
              <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
                <h3 className="mb-4 font-black text-gray-900">Motoboys</h3>
                {['Tiago Garcia - Livre', 'Carlos Entregas - Ocupado', 'Nina Express - Livre'].map(item => (
                  <div key={item} className="mb-3 flex items-center gap-3 rounded-2xl bg-gray-50 p-3 text-sm font-bold text-gray-600">
                    <Bike size={16} className="text-indigo-600" />
                    {item}
                  </div>
                ))}
              </div>
            </aside>
          </section>
        )}

        {activeDemo === 'cliente' && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-lg font-black text-gray-900">Loja da farmacia</h2>
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  ['Dipirona 500mg', 'R$ 12,90', 'Entrega normal'],
                  ['Vitamina C', 'R$ 34,90', 'Mais vendido'],
                  ['Termometro digital', 'R$ 49,90', 'Pronta entrega']
                ].map(product => (
                  <div key={product[0]} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <div className="mb-4 flex h-24 items-center justify-center rounded-xl bg-white text-indigo-600">
                      <Package size={32} />
                    </div>
                    <p className="font-black text-gray-900">{product[0]}</p>
                    <p className="text-lg font-black text-indigo-600">{product[1]}</p>
                    <p className="text-xs font-bold uppercase text-gray-400">{product[2]}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <h3 className="mb-5 font-black text-gray-900">Acompanhamento</h3>
              <div className="space-y-4">
                {[
                  ['Pedido recebido', '12:10', CheckCircle2, 'text-emerald-600'],
                  ['Pagamento confirmado', '12:12', ShieldCheck, 'text-indigo-600'],
                  ['Separando produtos', '12:18', Package, 'text-blue-600'],
                  ['Saiu para entrega', '12:31', Navigation, 'text-amber-600']
                ].map(([label, time, Icon, color]) => (
                  <div key={label as string} className="flex items-center gap-4 rounded-2xl bg-gray-50 p-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
                      <Icon size={18} className={color as string} />
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-gray-900">{label as string}</p>
                      <p className="text-xs font-bold uppercase text-gray-400">{time as string}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeDemo === 'motoboy' && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-lg font-black text-gray-900">App do motoboy</h2>
              {demoOrders.filter(order => order.status !== 'Aguardando aprovacao').map(order => (
                <div key={order.id} className="mb-4 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-black text-gray-900">#{order.code} - {order.customer}</p>
                      <p className="text-sm font-medium text-gray-500">{order.address}</p>
                      <p className="mt-2 text-xs font-black uppercase text-indigo-600">{order.items}</p>
                    </div>
                    <QrCode size={22} className="text-gray-400" />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase text-white">Iniciar rota</button>
                    <button className="rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black uppercase text-emerald-700">Entregar</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
              <h3 className="mb-5 font-black text-gray-900">Recursos demonstrados</h3>
              {[
                'Login por e-mail ou Google',
                'QR Code para vincular motoboy',
                'Pedidos por farmacia individual',
                'Pagamento por convenio/deixar na conta',
                'Exportacao/importacao de estoque',
                'Notificacao de atualizacao do aplicativo'
              ].map(item => (
                <div key={item} className="mb-3 flex items-center gap-3 rounded-2xl bg-gray-50 p-3 text-sm font-bold text-gray-600">
                  <CheckCircle2 size={18} className="text-emerald-600" />
                  {item}
                </div>
              ))}
            </div>
          </section>
        )}
        </div>
      </main>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <GlobalStyles />
          <AuthConsumerWrapper />
          <AppUpdateNotice />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

const AuthConsumerWrapper = () => {
  const { user, loading } = useAuth();
  const [showStartupLoading, setShowStartupLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notifiedStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    testConnection();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setShowStartupLoading(false);
    }, 3600);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // Filtramos a query de notificações para evitar 'permission-denied' e problemas de índice.
    let q;
    if (user.role === 'client') {
      q = query(collection(db, 'orders'), where('customerId', '==', user.uid));
    } else if (user.role === 'motoboy') {
      q = query(collection(db, 'orders'), where('pharmacyId', '==', getPharmacyId(user)), where('motoboyId', '==', user.uid));
    } else {
      q = query(collection(db, 'orders'), where('pharmacyId', '==', getPharmacyId(user)), limit(50));
    }

    return onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'modified') {
          const order = { id: change.doc.id, ...change.doc.data() } as Order;
          
          // Se já notificamos este status exato para este pedido, ignoramos
          if (notifiedStatuses.current[order.id] === order.status) return;

          let message = '';
          let type: 'info' | 'success' | 'warning' = 'info';

          if (user.role === 'client') {
            if (order.status === 'approved') {
              message = `Seu pedido de ${order.customerName} foi aprovado!`;
              type = 'success';
            } else if (order.status === 'in_transit') {
              message = `Seu pedido está em rota de entrega!`;
              type = 'info';
            } else if (order.status === 'delivered') {
              message = `Seu pedido foi entregue com sucesso!`;
              type = 'success';
            }
          }

          if (user.role === 'motoboy' && order.motoboyId === user.uid) {
            message = `Novo pedido atribuído: #${order.orderCode}`;
            type = 'info';
          }

          if (message) {
            // Registra que já notificamos este status
            notifiedStatuses.current[order.id] = order.status;

            setNotifications(prev => {
              // Mantemos a trava visual também por segurança
              const isDuplicate = prev.some(n => n.message === message && n.orderId === order.id);
              if (isDuplicate) return prev;

              const newNotif: Notification = {
                id: Math.random().toString(36).substr(2, 9),
                orderId: order.id,
                message,
                timestamp: Date.now(),
                type
              };
              return [newNotif, ...prev].slice(0, 5);
            });
          }
        }
      });
    });
  }, [user]);

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  if (loading || showStartupLoading) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/demo" element={<DemoView />} />
        <Route path="/cliente/*" element={<PortalLayout portal="cliente" />} />
        <Route path="/farmacia/*" element={<PortalLayout portal="farmacia" />} />
        <Route path="/motoboy/*" element={<PortalLayout portal="motoboy" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <NotificationToast notifications={notifications} remove={removeNotification} />
    </>
  );
};
