import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useErrors } from '../hooks/useErrors';
import { useInitFailure } from '../hooks/useInitFailure';

export function ErrorBanner() {
    const { errors, acknowledgeError } = useErrors();
    const { initFailed, error: initFailureError } = useInitFailure();

    if (!initFailed && errors.length === 0) return null;

    return (
        <div className="flex flex-col gap-2 p-4 bg-background/95 backdrop-blur border-b">
            {initFailed && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                        {initFailureError || 'Extension initialization failed'}
                    </AlertDescription>
                </Alert>
            )}
            {errors.map((error) => (
                <Alert key={error.code} variant={error.severity === 'error' ? 'destructive' : 'default'}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>{error.severity === 'error' ? 'Error' : 'Warning'}</AlertTitle>
                    <AlertDescription className="flex items-center justify-between gap-2">
                        <span>{error.message}</span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => acknowledgeError(error.code)}
                        >
                            <X className="h-4 w-4" />
                            <span className="sr-only">Dismiss</span>
                        </Button>
                    </AlertDescription>
                </Alert>
            ))}
        </div>
    );
};
