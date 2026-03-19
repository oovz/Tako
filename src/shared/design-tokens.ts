/**
 * Design Tokens - Tako Manga Downloader
 * 
 * Centralized design constants following Linus principles:
 * - Direct values, no abstractions
 * - Type-safe with TypeScript
 * - Single source of truth
 * 
 * Design System Foundation
 */

/**
 * Color Tokens
 * Based on shadcn/ui theming with semantic meaning
 */
export const COLORS = {
  // Status colors
  status: {
    ready: 'hsl(var(--muted))',
    downloading: 'hsl(var(--primary))',
    paused: 'hsl(var(--muted))',
    completed: 'hsl(142 76% 36%)', // Green-600
    failed: 'hsl(var(--destructive))',
  },
  
  // Badge semantic colors
  badge: {
    new: 'hsl(var(--primary))',    // Primary (interactive)
    success: 'hsl(142 76% 36%)',   // Green-600 (completed)
    error: 'hsl(0 84% 60%)',       // Red-500 (failed)
    stat: 'hsl(var(--muted))',     // Gray (passive info)
    rateLimit: 'hsl(48 96% 53%)',  // Yellow-500 (warning)
  },
  
  // Action colors
  action: {
    primary: 'hsl(var(--primary))',
    secondary: 'hsl(var(--secondary))',
    destructive: 'hsl(var(--destructive))',
  },
} as const

/**
 * Spacing Scale (4px base)
 * Usage guidelines:
 * - gap-1 (4px): Tight grouping (icon + text)
 * - gap-2 (8px): Default spacing (most use cases)
 * - gap-3 (12px): Section separation
 * - gap-4 (16px): Component spacing
 */
export const SPACING = {
  tight: '0.25rem',   // 4px - Icon margins, tight groups
  default: '0.5rem',  // 8px - Default gap between elements
  relaxed: '0.75rem', // 12px - Section separation
  loose: '1rem',      // 16px - Component spacing
} as const

/**
 * Typography Scale
 * Follows Tailwind's font-size scale
 */
export const TYPOGRAPHY = {
  sizes: {
    xs: '0.75rem',    // 12px - Labels, metadata
    sm: '0.875rem',   // 14px - Body text, buttons
    base: '1rem',     // 16px - Default body
    lg: '1.125rem',   // 18px - Subheadings
    xl: '1.25rem',    // 20px - Headings
  },
  
  weights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  
  lineHeights: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
} as const

/**
 * Animation Timing
 * Consistent durations across the app
 */
export const ANIMATION = {
  duration: {
    fast: '150ms',     // Hover, focus effects
    normal: '300ms',   // Transitions, fades
    slow: '500ms',     // Complex animations
  },
  
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',  // ease-in-out
    in: 'cubic-bezier(0.4, 0, 1, 1)',         // ease-in
    out: 'cubic-bezier(0, 0, 0.2, 1)',        // ease-out
  },
} as const

/**
 * Shadow Depths
 * Based on Material Design elevation
 */
export const SHADOWS = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
} as const

/**
 * Border Radius
 * Consistent rounding across components
 */
export const RADIUS = {
  sm: '0.375rem',  // 6px - Small buttons, badges
  md: '0.5rem',    // 8px - Default inputs, cards
  lg: '0.75rem',   // 12px - Large containers
  full: '9999px',  // Fully rounded (pills, avatars)
} as const

/**
 * Z-Index Layers
 * Prevents z-index chaos
 */
export const Z_INDEX = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  modal: 1030,
  popover: 1040,
  tooltip: 1050,
} as const

/**
 * Component-Specific Tokens
 */
export const COMPONENTS = {
  button: {
    height: {
      sm: '2rem',    // 32px
      md: '2.5rem',  // 40px
      lg: '3rem',    // 48px
    },
    padding: {
      sm: '0.5rem 0.75rem',  // 8px 12px
      md: '0.75rem 1rem',    // 12px 16px
      lg: '1rem 1.5rem',     // 16px 24px
    },
  },
  
  badge: {
    height: '1.5rem',  // 24px
    padding: '0.25rem 0.5rem',  // 4px 8px
  },
  
  card: {
    padding: '1rem',   // 16px
    maxWidth: '20rem', // 320px (on-page UI)
  },
  
  popup: {
    width: '25rem',    // 400px
    height: '37.5rem', // 600px
  },
} as const

/**
 * Breakpoints (for responsive design)
 * Not heavily used in extension, but available if needed
 */
export const BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const

/**
 * Type exports for IDE autocomplete
 */
export type ColorToken = typeof COLORS
export type SpacingToken = typeof SPACING
export type TypographyToken = typeof TYPOGRAPHY
export type AnimationToken = typeof ANIMATION
export type ShadowToken = typeof SHADOWS
export type RadiusToken = typeof RADIUS
export type ZIndexToken = typeof Z_INDEX
export type ComponentToken = typeof COMPONENTS
export type BreakpointToken = typeof BREAKPOINTS
