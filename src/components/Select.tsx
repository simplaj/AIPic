import { useState, useRef, useEffect, useId } from 'react'
import { Select as KumoSelect } from '@cloudflare/kumo/components/select'
import { Button as KumoButton } from '@cloudflare/kumo/components/button'
import { createPortal } from 'react-dom'
import { DEFAULT_DROPDOWN_MAX_HEIGHT } from '../lib/dropdown'
import { ChevronDownIcon, EditIcon, PlusIcon, TrashIcon, DragHandleIcon } from './icons'

interface Option {
  label: string
  value: string | number
  variant?: 'action' | 'danger'
  draggable?: boolean
  actions?: Array<{
    label: string
    variant?: 'danger'
    onClick: () => void
  }>
}

interface SelectProps {
  value: string | number
  onChange: (value: any) => void
  onReorder?: (sourceValue: string | number, targetValue: string | number, position: 'before' | 'after' | null) => void
  options: Option[]
  disabled?: boolean
  className?: string
  tone?: 'default' | 'dark'
}

export default function Select(props: SelectProps) {
  if (props.onReorder || props.options.some((option) => option.variant || option.actions?.length || option.draggable)) {
    return <ReorderableSelect {...props} />
  }
  return <KumoSelect
    value={props.value}
    onValueChange={(value) => value !== null && props.onChange(value)}
    items={props.options.map(({ value, label }) => ({ value, label }))}
    disabled={props.disabled}
    aria-label={props.options.find((option) => option.value === props.value)?.label ?? '选择选项'}
    className={`studio-select ${props.className ?? ''}`}
  />
}

function ReorderableSelect({ value, onChange, onReorder, options, disabled, className, tone = 'default' }: SelectProps) {
  const menuId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState(DEFAULT_DROPDOWN_MAX_HEIGHT)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const [draggedValue, setDraggedValue] = useState<string | number | null>(null)
  const [dragOverValue, setDragOverValue] = useState<string | number | null>(null)
  const [dragDropPosition, setDragDropPosition] = useState<'before' | 'after' | null>(null)
  const [touchDragPreview, setTouchDragPreview] = useState<{
    label: string
    x: number
    y: number
    width: number
    height: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const touchDragRef = useRef<{ value: string | number, startX: number, startY: number, moved: boolean } | null>(null)
  const dragScrollIntervalRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  useEffect(() => {
    return () => {
      if (dragScrollIntervalRef.current) clearInterval(dragScrollIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (!touchDragPreview) return

    const preventTouchScroll = (event: TouchEvent) => {
      event.preventDefault()
    }
    const listenerOptions = { passive: false, capture: true } as AddEventListenerOptions
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior

    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    window.addEventListener('touchmove', preventTouchScroll, listenerOptions)

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
      window.removeEventListener('touchmove', preventTouchScroll, listenerOptions)
    }
  }, [touchDragPreview])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const updateMenuMaxHeight = () => {
      if (!triggerRef.current) return
      const trigger = triggerRef.current
      const rect = trigger.getBoundingClientRect()
      
      let availableBelow = window.innerHeight - rect.bottom - 8
      let availableAbove = rect.top - 8
      
      let parent = trigger.parentElement
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent)
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowY}`)) {
          const parentRect = parent.getBoundingClientRect()
          availableBelow = Math.min(availableBelow, parentRect.bottom - rect.bottom - 8)
          availableAbove = Math.min(availableAbove, rect.top - parentRect.top - 8)
        }
        parent = parent.parentElement
      }
      
      let newPlacement: 'bottom' | 'top' = 'bottom'
      let maxHeight = DEFAULT_DROPDOWN_MAX_HEIGHT
      
      if (availableBelow < 120 && availableAbove > availableBelow) {
        newPlacement = 'top'
        maxHeight = Math.min(DEFAULT_DROPDOWN_MAX_HEIGHT, Math.floor(availableAbove))
      } else {
        newPlacement = 'bottom'
        maxHeight = Math.min(DEFAULT_DROPDOWN_MAX_HEIGHT, Math.floor(availableBelow))
      }
      
      setPlacement(newPlacement)
      setMenuMaxHeight(Math.max(0, maxHeight))
    }

    updateMenuMaxHeight()
    window.addEventListener('resize', updateMenuMaxHeight)
    window.addEventListener('scroll', updateMenuMaxHeight, true)
    return () => {
      window.removeEventListener('resize', updateMenuMaxHeight)
      window.removeEventListener('scroll', updateMenuMaxHeight, true)
    }
  }, [isOpen])

  const handleToggle = (e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    // 动画和位置的计算在 useEffect 中进行，这里可以先假设一个默认值或保留当前状态
    setIsOpen(!isOpen)
  }

  const clearTouchDrag = () => {
    touchDragRef.current = null
    setTouchDragPreview(null)
    setDraggedValue(null)
    setDragOverValue(null)
    setDragDropPosition(null)
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current)
      dragScrollIntervalRef.current = null
    }
  }

  return (
    <div
      ref={containerRef}
      data-tone={tone}
      className="apple-select relative w-full"
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault()
          event.stopPropagation()
          setIsOpen(false)
          triggerRef.current?.focus()
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const direction = event.key === 'ArrowDown' ? 1 : -1
          setIsOpen(true)
          requestAnimationFrame(() => {
            const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
            if (items.length === 0) return
            const currentIndex = items.findIndex((item) => item === document.activeElement)
            const selectedIndex = options.findIndex((option) => option.value === value)
            const nextIndex = currentIndex < 0
              ? Math.max(0, selectedIndex)
              : (currentIndex + direction + items.length) % items.length
            items[nextIndex]?.focus()
          })
        }
      }}
    >
      <KumoButton
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={handleToggle}
        className={`apple-select-trigger flex min-h-11 w-full items-center justify-between gap-3 text-left ${className ?? ''}`}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[var(--apple-secondary)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </KumoButton>

      {isOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label={selectedOption?.label ?? String(value)}
          className={`apple-select-menu custom-scrollbar absolute z-50 w-full overflow-y-auto p-1.5 ${
            placement === 'top' ? 'bottom-full mb-2 animate-dropdown-up' : 'top-full mt-2 animate-dropdown-down'
          }`}
          style={{ maxHeight: menuMaxHeight }}
        >
          {options.map((option) => (
            <div
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              data-variant={option.variant}
              data-dragging={draggedValue === option.value || undefined}
              tabIndex={0}
              data-option-value={String(option.value)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChange(option.value)
                  setIsOpen(false)
                  triggerRef.current?.focus()
                }
              }}
              draggable={option.draggable}
              onDragStart={(e) => {
                if (!option.draggable) return
                setDraggedValue(option.value)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(option.value))
              }}
              onDragOver={(e) => {
                if (!option.draggable || !draggedValue) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'

                const targetElement = e.currentTarget as HTMLElement
                const rect = targetElement.getBoundingClientRect()
                const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'

                if (dragOverValue !== option.value || dragDropPosition !== position) {
                  setDragOverValue(option.value)
                  setDragDropPosition(position)
                }

                // Auto-scroll
                const scrollContainer = targetElement.parentElement
                if (scrollContainer) {
                  const containerRect = scrollContainer.getBoundingClientRect()
                  const scrollThreshold = 30

                  if (e.clientY < containerRect.top + scrollThreshold) {
                    scrollContainer.scrollTop -= 10
                  } else if (e.clientY > containerRect.bottom - scrollThreshold) {
                    scrollContainer.scrollTop += 10
                  }
                }
              }}
              onDragEnd={() => {
                setDraggedValue(null)
                setDragOverValue(null)
                setDragDropPosition(null)
              }}
              onDrop={(e) => {
                if (!option.draggable || !onReorder) return
                e.preventDefault()
                setDraggedValue(null)
                setDragOverValue(null)
                setDragDropPosition(null)

                const sourceValue = e.dataTransfer.getData('text/plain')
                const sourceOption = options.find(o => String(o.value) === sourceValue)
                if (sourceOption && sourceOption.value !== option.value) {
                  onReorder(sourceOption.value, option.value, dragDropPosition)
                }
              }}
              onTouchStart={(e) => {
                if (!option.draggable) return
                const target = e.target as HTMLElement
                if (!target.closest('[data-drag-handle]')) return

                const touch = e.touches[0]
                const rect = e.currentTarget.getBoundingClientRect()
                // Do not prevent default here, as it blocks scrolling
                // e.preventDefault()
                e.stopPropagation()
                touchDragRef.current = { value: option.value, startX: touch.clientX, startY: touch.clientY, moved: false }
                setDraggedValue(option.value)
                setTouchDragPreview({
                  label: option.label,
                  x: touch.clientX,
                  y: touch.clientY,
                  width: rect.width,
                  height: rect.height,
                  offsetX: touch.clientX - rect.left,
                  offsetY: touch.clientY - rect.top,
                })
              }}
              onTouchMove={(e) => {
                const drag = touchDragRef.current
                if (!drag || !option.draggable) return
                const touch = e.touches[0]

                if (!drag.moved) {
                  if (Math.abs(touch.clientX - drag.startX) > 5 || Math.abs(touch.clientY - drag.startY) > 5) {
                    drag.moved = true
                  } else {
                    return
                  }
                }

                e.preventDefault() // prevent scrolling
                setTouchDragPreview((current) => current ? { ...current, x: touch.clientX, y: touch.clientY } : current)

                // Hide preview visually so elementFromPoint works correctly
                const previewEl = document.getElementById('touch-drag-preview')
                if (previewEl) previewEl.style.pointerEvents = 'none'

                const el = document.elementFromPoint(touch.clientX, touch.clientY)
                const targetDiv = el?.closest('[data-option-value]') as HTMLElement
                if (targetDiv) {
                  const targetValueStr = targetDiv.getAttribute('data-option-value')
                  if (targetValueStr) {
                    const targetOption = options.find(o => String(o.value) === targetValueStr)
                    if (targetOption && targetOption.draggable) {
                      const rect = targetDiv.getBoundingClientRect()
                      const position = touch.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                      if (dragOverValue !== targetOption.value || dragDropPosition !== position) {
                        setDragOverValue(targetOption.value)
                        setDragDropPosition(position)
                      }
                    }
                  }
                }

                const scrollContainer = targetDiv?.closest('.custom-scrollbar') as HTMLElement
                if (scrollContainer) {
                  const containerRect = scrollContainer.getBoundingClientRect()
                  const scrollThreshold = 30

                  if (dragScrollIntervalRef.current) {
                    clearInterval(dragScrollIntervalRef.current)
                    dragScrollIntervalRef.current = null
                  }

                  if (touch.clientY < containerRect.top + scrollThreshold) {
                    dragScrollIntervalRef.current = window.setInterval(() => {
                      scrollContainer.scrollTop -= 5
                    }, 16)
                  } else if (touch.clientY > containerRect.bottom - scrollThreshold) {
                    dragScrollIntervalRef.current = window.setInterval(() => {
                      scrollContainer.scrollTop += 5
                    }, 16)
                  }
                }
              }}
              onTouchEnd={(e) => {
                const drag = touchDragRef.current
                if (!drag || !drag.moved) {
                  clearTouchDrag()
                  return
                }

                e.preventDefault()

                if (onReorder && dragOverValue !== null && dragOverValue !== drag.value) {
                  onReorder(drag.value, dragOverValue, dragDropPosition)
                }

                clearTouchDrag()
              }}
              onTouchCancel={clearTouchDrag}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button, [data-drag-handle]')) return
                e.preventDefault()
                onChange(option.value)
                setIsOpen(false)
              }}
              className="apple-select-option relative flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-[13px]"
            >
              {dragOverValue === option.value && dragDropPosition === 'before' && draggedValue !== option.value && (
                <div className="absolute -top-[1px] left-0 right-0 h-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
              )}
              {dragOverValue === option.value && dragDropPosition === 'after' && draggedValue !== option.value && (
                <div className="absolute -bottom-[1px] left-0 right-0 h-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
              )}
              <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
                {option.draggable && (
                  <div
                    data-drag-handle
                    className="flex min-h-11 min-w-8 cursor-grab items-center justify-center text-[var(--apple-secondary)] opacity-70 transition-opacity hover:opacity-100 active:cursor-grabbing"
                    style={{ touchAction: 'none' }}
                    title="拖拽排序"
                  >
                    <DragHandleIcon className="h-3.5 w-3.5" />
                  </div>
                )}
                <span className="min-w-0 truncate">{option.label}</span>
              </div>
              {option.value === value && !option.variant && (
                <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--apple-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                </svg>
              )}
              {option.actions?.length ? (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {option.actions.map((action) => (
                    <KumoButton
                      key={action.label}
                      type="button"
                      title={action.label}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        action.onClick()
                        setIsOpen(false)
                      }}
                      data-tone={action.variant === 'danger' ? 'danger' : 'secondary'}
                      className="apple-icon-button"
                    >
                      {action.label === '编辑' ? (
                        <EditIcon className="w-3.5 h-3.5" />
                      ) : action.label === '删除' ? (
                        <TrashIcon className="w-3.5 h-3.5" />
                      ) : (
                        action.label
                      )}
                    </KumoButton>
                  ))}
                </span>
              ) : null}
              {option.variant === 'action' && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <PlusIcon className="h-4 w-4" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {touchDragPreview && createPortal(
        <div
          id="touch-drag-preview"
          className="apple-select-menu fixed pointer-events-none z-[110] flex items-center justify-between gap-3 px-3 py-3 text-[13px]"
          style={{
            left: touchDragPreview.x - touchDragPreview.offsetX,
            top: touchDragPreview.y - touchDragPreview.offsetY,
            width: touchDragPreview.width,
            minHeight: touchDragPreview.height,
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
            <DragHandleIcon className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
            <span className="min-w-0 truncate">{touchDragPreview.label}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
