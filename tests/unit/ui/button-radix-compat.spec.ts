import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

describe('Button Radix compatibility', () => {
  it('renders shadcn Button in asChild mode with inherited button styles', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Button,
        { asChild: true, variant: 'outline' },
        React.createElement('a', { href: '#target' }, 'Open'),
      ),
    )

    expect(html).toContain('<a')
    expect(html).toContain('href="#target"')
    expect(html).toContain('border border-input')
  })

  it('renders the owned Button primitive with the slot marker and variant classes', () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, { variant: 'ghost' }, 'Trigger'),
    )

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('hover:bg-accent')
  })
})
