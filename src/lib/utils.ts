import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/*
 * Tailwind v4 lets us declare custom font-size utilities like `text-body` via
 * `@theme` in `index.css`. tailwind-merge needs to know those names are
 * font-sizes — otherwise it sees `text-body` next to `text-white` and assumes
 * one is overriding the other, silently dropping the size class. Register the
 * scale here so `cn()` keeps the right utility on the element.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['meta', 'small', 'body', 'heading'] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
