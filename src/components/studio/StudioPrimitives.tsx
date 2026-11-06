import { Button, type ButtonProps } from '@cloudflare/kumo/components/button'
import { Select } from '@cloudflare/kumo/components/select'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import { Dialog } from '@cloudflare/kumo/primitives/dialog'
import { X } from 'lucide-react'
import { Children, isValidElement, Fragment, type ComponentProps, type ReactNode, type RefObject, type Ref } from 'react'

/** Kumo owns interaction and accessibility; shared variants unify the studio. */
export function StudioButton({ tone = 'default', className = '', ...props }: Omit<ButtonProps, 'variant' | 'shape'> & {
  tone?: 'default' | 'primary' | 'ghost' | 'danger'
  ref?: Ref<HTMLButtonElement>
}) {
  return <Button {...props} data-studio-tone={tone} size={props.size ?? 'sm'} variant={tone === 'default' ? 'secondary' : tone === 'danger' ? 'destructive' : tone} className={`studio-button ${className}`} />
}

/** Underline tabs avoid the segmented variant's extra translated backdrop. */
export function StudioTabs({ className = '', ...props }: Omit<ComponentProps<typeof Tabs>, 'variant' | 'size' | 'listClassName' | 'indicatorClassName'>) {
  return <Tabs {...props} variant="underline" size="sm" className={`studio-tabs ${className}`} listClassName="studio-tabs-list" indicatorClassName="studio-tabs-indicator" />
}

export function StudioSelect({ value, onValueChange, children, ...props }: {
  value: string | number
  onValueChange: (value: string) => void
  children: ReactNode
  disabled?: boolean
  className?: string
  'aria-label': string
}) {
  function options(nodes: ReactNode): Array<{ value: string; label: ReactNode; disabled?: boolean }> {
    return Children.toArray(nodes).flatMap((node) => {
      if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(node)) return []
      if (node.type === Fragment) return options(node.props.children)
      return [{ value: String(node.props.value ?? ''), label: node.props.children, disabled: node.props.disabled }]
    })
  }
  // Supply labels before the portalled options mount on the first open.
  const items = options(children)
  return <Select {...props} items={items} value={String(value)} onValueChange={(next) => next !== null && onValueChange(next)} className={`studio-select ${props.className ?? ''}`}>
    {items.map((option) => <Select.Option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</Select.Option>)}
  </Select>
}

export function StudioSheet({ open, onOpenChange, title, description, children, footer, side = 'right', returnFocusRef }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  side?: 'left' | 'right'
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Backdrop className="studio-sheet-overlay" />
      <Dialog.Popup className={`studio-sheet studio-sheet--${side}`} finalFocus={returnFocusRef}>
        <header className="studio-sheet-heading"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div>
          <StudioButton tone="ghost" className="studio-icon-button" aria-label={`关闭${title}`} onClick={() => onOpenChange(false)}><X size={17} /></StudioButton>
        </header>
        <div className="studio-sheet-body">{children}</div>
        {footer && <footer className="studio-sheet-footer">{footer}</footer>}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}
