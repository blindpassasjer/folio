import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  danger: 'btn--danger',
  ghost: 'btn--ghost',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Defaults to `secondary` (the neutral surface look). */
  variant?: Variant;
  size?: Size;
  /** Full-width. */
  block?: boolean;
  /** Icon-only square padding; pass an `aria-label` when using this. */
  iconOnly?: boolean;
  /** Leading icon element (rendered before children). */
  icon?: ReactNode;
}

/**
 * Canonical button. Renders `.btn` + modifier classes (see index.css).
 * Extra `className` is appended, so layout add-ons like `login-submit` still work.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, iconOnly, icon, className, children, type, ...rest },
  ref,
) {
  const classes = [
    'btn',
    VARIANT_CLASS[variant],
    size === 'sm' && 'btn--sm',
    block && 'btn--block',
    iconOnly && 'btn--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type ?? 'button'} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
});
