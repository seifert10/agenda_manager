import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TrafficLights } from './TrafficLights';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  showTrafficLights?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'md',
  showTrafficLights = true,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  };

  return createPortal(
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop com blur macOS */}
      <div
        className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Janela'}
        className={`modal-panel relative flex min-w-0 flex-col w-full ${maxWidthClasses[maxWidth]} bg-white/95 dark:bg-zinc-850 dark:bg-zinc-900/95 mac-blur rounded-3xl border border-black/[0.08] dark:border-white/[0.1] shadow-mac-modal overflow-hidden transition-all duration-200 animate-in fade-in zoom-in-95`}
      >
        {/* Header no estilo de janela do macOS */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-b border-black/[0.05] dark:border-white/[0.08] bg-zinc-50/50 dark:bg-zinc-800/40">
          <div className="min-w-0 flex items-center gap-3">
            {showTrafficLights && <div className="hidden sm:block shrink-0"><TrafficLights onClose={onClose} /></div>}
            {title && (
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {subtitle}
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            aria-label="Fechar janela"
            className="shrink-0 min-h-11 min-w-11 flex items-center justify-center p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="min-h-0 min-w-0 p-4 sm:p-6 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>, document.body
  );
};

export default Modal;
