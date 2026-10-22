import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  elevated?: boolean
}

export function Card({ children, elevated = false, className = '', ...rest }: CardProps) {
  const classes = [
    'rounded-2xl border border-elev/50 p-4 shadow-sm',
    elevated ? 'bg-elev/60' : 'bg-card',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
