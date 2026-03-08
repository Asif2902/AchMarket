import { useState, useEffect, useCallback } from 'react';
import { NETWORK } from '../config/network';

export interface ToastData {
  id: string;
  type: 'success' | 'error' | 'info' | 'pending';
  title: string;
  message?: string;
  txHash?: string;
  duration?: number;
}

let toastIdCounter = 0;
let addToastFn: ((toast: Omit<ToastData, 'id'>) => void) | null = null;

export function showToast(toast: Omit<ToastData, 'id'>) {
  if (addToastFn) {
    addToastFn(toast);
  }
}

function ToastItem({ toast, onRemove }: { toast: ToastData; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (toast.type === 'pending') return;
    const duration = toast.duration || 6000;
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onRemove(toast.id), 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [toast, onRemove]);

  const handleClose = () => {
    setExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  };

  const scannerUrl = toast.txHash
    ? `${NETWORK.blockExplorer}/tx/${toast.txHash}`
    : null;

  const iconBg =
    toast.type === 'success' ? 'bg-emerald-500/15' :
    toast.type === 'error' ? 'bg-red-500/15' :
    toast.type === 'pending' ? 'bg-amber-500/15' :
    'bg-primary-500/15';

  const borderColor =
    toast.type === 'success' ? 'border-emerald-500/20' :
    toast.type === 'error' ? 'border-red-500/20' :
    toast.type === 'pending' ? 'border-amber-500/20' :
    'border-primary-500/20';

  return (
    <div
      className={`relative flex items-start gap-3 p-4 rounded-2xl border backdrop-blur-xl shadow-2xl transition-all duration-300 ${borderColor} bg-dark-900/95 ${
        exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
      }`}
      style={{ width: 'min(92vw, 420px)' }}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
    >
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center shrink-0 mt-0.5`}>
        {toast.type === 'success' && (
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {toast.type === 'error' && (
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        {toast.type === 'pending' && (
          <div className="w-5 h-5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
        )}
        {toast.type === 'info' && (
          <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-snug">{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-dark-400 mt-0.5 leading-relaxed">{toast.message}</p>
        )}
        {scannerUrl && (
          <a
            href={scannerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/20 text-xs font-semibold text-primary-400 hover:text-primary-300 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View on Explorer
          </a>
        )}
      </div>

      <button
        onClick={handleClose}
        className="text-dark-500 hover:text-dark-300 transition-colors p-0.5 rounded-lg hover:bg-white/[0.05] shrink-0"
        aria-label="Dismiss notification"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = `toast-${++toastIdCounter}`;
    setToasts(prev => {
      let filtered = prev;
      if (toast.txHash && toast.type !== 'pending') {
        filtered = prev.filter(t => !(t.txHash === toast.txHash && t.type === 'pending'));
      }
      const combined = [...filtered, { ...toast, id }];
      return combined.slice(-4);
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none" aria-live="polite" aria-atomic="true">
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto animate-slide-in-right">
          <ToastItem toast={toast} onRemove={removeToast} />
        </div>
      ))}
    </div>
  );
}
