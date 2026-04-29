import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => (
    <label className={cn('relative inline-flex h-4 w-4 shrink-0', className)}>
      <input
        type="checkbox"
        ref={ref}
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        className="peer sr-only"
        {...props}
      />
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded-sm border border-primary shadow transition-colors',
          'peer-focus-visible:outline-none peer-focus-visible:ring-1 peer-focus-visible:ring-ring',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          'peer-checked:bg-primary peer-checked:text-primary-foreground',
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
    </label>
  ),
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
