import { clsx } from 'clsx';
import { forwardRef } from 'react';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'ghost';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  default: 'bg-accent text-accent-foreground hover:bg-accent/90',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
  outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
};

const sizeStyles: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 px-3 text-sm',
  lg: 'h-12 px-6 text-lg',
  icon: 'h-10 w-10',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex items-center justify-center rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-50',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';

export { Button };
export type { ButtonProps };
