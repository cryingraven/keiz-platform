import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `text-ui`, `text-small` and friends are font-size tokens from `@theme`.
 * tailwind-merge cannot infer that from a custom name and would treat them as
 * text colours, dropping a real `text-white`/`text-muted` in the same string.
 * Registering them as the font-size group keeps colour and size independent.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-meta', 'text-small', 'text-ui', 'text-copy', 'text-heading', 'text-title'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
