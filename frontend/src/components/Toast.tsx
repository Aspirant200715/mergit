import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; key: number } | null>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage({ text, key: Date.now() });
    timer.current = window.setTimeout(() => setMessage(null), 1800);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div key={message.key} className="toast" role="status">
          {message.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/** Copy text and confirm with a toast. */
export function useCopy() {
  const toast = useToast();
  return useCallback(
    (text: string, label = "Copied") => {
      navigator.clipboard?.writeText(text).then(
        () => toast(label),
        () => toast("Copy failed"),
      );
    },
    [toast],
  );
}
