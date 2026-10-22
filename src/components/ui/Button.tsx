import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-[#0f172a] hover:brightness-110 active:brightness-95',
  secondary: 'bg-elev text-ink hover:bg-elev/80',
  ghost: 'border border-elev bg-transparent text-ink hover:bg-elev/40',
  danger: 'bg-danger text-white hover:brightness-110',
  success: 'bg-success text-[#0f172a] hover:brightness-110',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'lg' | 'xl'
  fullWidth?: boolean
  children?: ReactNode
}

const SIZES = {
  md: 'min-h-touch px-4 py-2 text-sm',
  lg: 'min-h-touch px-5 py-3 text-base',
  xl: 'min-h-[64px] px-5 py-4 text-lg',
} as const

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
    'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
    SIZES[size],
    VARIANTS[variant],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}
