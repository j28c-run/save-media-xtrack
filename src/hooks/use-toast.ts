import { useState, useEffect, useCallback } from 'react'

export type Toast = {
  id: string
  title?: string
  description?: string
  action?: React.ReactNode
  variant?: 'default' | 'destructive'
}

const TOAST_LIMIT = 3
const TOAST_REMOVE_DELAY = 5000

let count = 0
generateId = () => `${count++}`
let toasts: Toast[] = []
let listeners: Array<(toasts: Toast[]) => void> = []

export function toast({ title, description, variant }: Omit<Toast, 'id'>) {
  const id = generateId()
  toasts = [...toasts.filter(t => t.id !== id), { id, title, description, variant }].slice(-TOAST_LIMIT)
  listeners.forEach(l => l(toasts))
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id)
    listeners.forEach(l => l(toasts))
  }, TOAST_REMOVE_DELAY)
}

export function useToast() {
  const [state, setState] = useState(toasts)
  useEffect(() => {
    listeners.push(setState)
    return () => { listeners = listeners.filter(l => l !== setState) }
  }, [])
  return { toasts: state, toast }
}
