import React from 'react';

import { Button } from '@/components/ui/button';

interface InlineConfirmationProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineConfirmation({
  title,
  description,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  onConfirm,
  onCancel,
}: InlineConfirmationProps) {
  return (
    <div className="absolute inset-0 z-20 rounded-md border border-border bg-background/95 p-2 backdrop-blur-sm">
      <div className="flex h-full items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{title}</p>
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
