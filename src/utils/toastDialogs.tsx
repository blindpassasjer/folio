/* eslint-disable react-refresh/only-export-components */
import { useState, type CSSProperties } from 'react';
import toast from 'react-hot-toast';
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

const toastActionsStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.45rem',
  marginTop: '0.7rem',
} as const;

const toastBtnStyle = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0.3rem 0.65rem',
  fontSize: '0.85rem',
} as const;

const toastConfirmBtnStyle = {
  ...toastBtnStyle,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-contrast)',
} as const;

const PROMPT_TIMEOUT_MS = 30000;
const CONFIRM_TIMEOUT_MS = 20000;

export function showConfirmToast(
  message: string,
  options?: { confirmLabel?: string; cancelLabel?: string }
): Promise<boolean> {
  return new Promise((resolve) => {
    const anchor = getActiveToastAnchor();
    let toastId = '';
    let settled = false;

    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      toast.remove(toastId);
      resolve(value);
    };

    const timeoutId = window.setTimeout(() => settle(false), CONFIRM_TIMEOUT_MS);

    toastId = toast.custom(
      () => (
        <div style={{ ...toastCardStyle, ...getAnchoredToastStyle(anchor) }} role="dialog" aria-live="assertive">
          <p>{message}</p>
          <div style={toastActionsStyle}>
            <button style={toastBtnStyle} onClick={() => settle(false)}>
              {options?.cancelLabel ?? 'Cancel'}
            </button>
            <button style={toastConfirmBtnStyle} onClick={() => settle(true)}>
              {options?.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      ),
      { duration: Infinity, position: 'top-center' }
    );
  });
}

interface PromptToastProps {
  label: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  anchorStyle: CSSProperties;
  onSubmit: (value: string | null) => void;
}

function PromptToast({
  label,
  initialValue,
  placeholder,
  confirmLabel,
  cancelLabel,
  anchorStyle,
  onSubmit,
}: PromptToastProps) {
  const [value, setValue] = useState(initialValue);

  const submit = () => onSubmit(value);

  return (
    <div style={{ ...toastCardStyle, ...anchorStyle }} role="dialog" aria-live="assertive">
      <label style={{ display: 'block', fontSize: '0.88rem' }}>
        {label}
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onSubmit(null);
            }
          }}
          style={{
            width: '100%',
            marginTop: '0.45rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)',
            color: 'var(--text)',
            padding: '0.35rem 0.5rem',
          }}
        />
      </label>
      <div style={toastActionsStyle}>
        <button
          style={toastBtnStyle}
          onClick={() => {
            onSubmit(null);
          }}
        >
          {cancelLabel}
        </button>
        <button style={toastConfirmBtnStyle} onClick={submit}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

export function showPromptToast(
  label: string,
  options?: {
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }
): Promise<string | null> {
  return new Promise((resolve) => {
    const anchor = getActiveToastAnchor();
    let toastId = '';
    let settled = false;

    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      toast.remove(toastId);
      resolve(value);
    };

    const timeoutId = window.setTimeout(() => settle(null), PROMPT_TIMEOUT_MS);

    toastId = toast.custom(
      () => (
        <PromptToast
          label={label}
          initialValue={options?.initialValue ?? ''}
          placeholder={options?.placeholder}
          confirmLabel={options?.confirmLabel ?? 'Save'}
          cancelLabel={options?.cancelLabel ?? 'Cancel'}
          anchorStyle={getAnchoredToastStyle(anchor)}
          onSubmit={settle}
        />
      ),
      { duration: Infinity, position: 'top-center' }
    );
  });
}