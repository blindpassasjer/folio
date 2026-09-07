import hotToast, { type ToastOptions } from 'react-hot-toast';
import { getActiveToastAnchor, getAnchoredToastStyle } from './toastAnchor';

const toastCardStyle = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: 'var(--shadow)',
  padding: '0.7rem 0.8rem',
  minWidth: '280px',
  maxWidth: '420px',
} as const;

type AnchoredToastOptions = ToastOptions & { 
  icon?: string;
  action?: {
    label: string;
    href: string;
  };
};

function dismissOnNextInteraction(toastId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const dismiss = () => {
    window.removeEventListener('pointerdown', dismiss, true);
    window.removeEventListener('touchstart', dismiss, true);
    window.removeEventListener('click', dismiss, true);
    hotToast.dismiss(toastId);
  };

  // Delay listener registration so the interaction that triggered the toast
  // does not immediately dismiss it.
  window.setTimeout(() => {
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('touchstart', dismiss, true);
    window.addEventListener('click', dismiss, true);
  }, 0);
}

function showAnchoredToast(message: string | React.ReactNode, options?: AnchoredToastOptions): string {
  const anchor = getActiveToastAnchor();
  const icon = options?.icon;
  const action = options?.action;

  const toastId = hotToast.custom(
    () => (
      <div style={{ ...toastCardStyle, ...getAnchoredToastStyle(anchor) }} role="status" aria-live="polite">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {icon ? <span style={{ marginRight: '0.45rem', flexShrink: 0 }}>{icon}</span> : null}
            <span style={{ wordBreak: 'break-word' }}>{message}</span>
          </div>
          {action ? (
            <a
              href={action.href}
              style={{
                color: 'var(--accent, #0f766e)',
                textDecoration: 'none',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                flexShrink: 0,
                padding: '0.3rem 0.5rem',
                borderRadius: 'var(--radius-xs)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecoration = 'none';
              }}
            >
              {action.label}
            </a>
          ) : null}
        </div>
      </div>
    ),
    {
      id: options?.id,
      duration: options?.duration,
      ariaProps: options?.ariaProps,
      position: 'top-left',
    }
  );

  dismissOnNextInteraction(toastId);
  return toastId;
}

const toast = Object.assign(
  (message: string | React.ReactNode, options?: AnchoredToastOptions) => showAnchoredToast(message, options),
  {
    success: (message: string | React.ReactNode, options?: AnchoredToastOptions) => showAnchoredToast(message, options),
    error: (message: string | React.ReactNode, options?: AnchoredToastOptions) => showAnchoredToast(message, options),
    dismiss: hotToast.dismiss,
    custom: hotToast.custom,
  }
);

export default toast;
