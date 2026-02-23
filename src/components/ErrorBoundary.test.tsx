import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary', () => {
    it('renders children when there is no error', () => {
        const { getByText } = render(
            <ErrorBoundary>
                <div>Normal content</div>
            </ErrorBoundary>
        );
        expect(getByText('Normal content')).toBeTruthy();
    });
});

