import type React from 'react'
import { Checkbox as KumoCheckbox } from '@cloudflare/kumo/components/checkbox'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  tone?: 'primary' | 'danger'
}

export function Checkbox({ checked, onChange, label, tone = 'primary', className, ...props }: CheckboxProps) {
  return <div className={className} id={props.id}>
    <KumoCheckbox checked={checked} onCheckedChange={(next) => onChange(next)} label={label}
      variant={tone === 'danger' ? 'error' : 'default'} disabled={props.disabled} required={props.required}
      name={props.name} aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} />
  </div>
}
