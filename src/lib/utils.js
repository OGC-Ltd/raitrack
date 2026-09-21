import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui's class helper: conditional classes, with later Tailwind utilities
 *  beating earlier ones instead of both landing in the class list. */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
