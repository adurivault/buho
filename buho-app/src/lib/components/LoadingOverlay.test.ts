import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import LoadingOverlay from './LoadingOverlay.svelte';

describe('LoadingOverlay', () => {
    it('renders with the provided message', () => {
        const message = 'Loading test data...';
        render(LoadingOverlay, { message });

        expect(screen.getByText(message)).toBeInTheDocument();
    });

    it('renders a spinner or progress indicator', () => {
        render(LoadingOverlay, { message: 'Loading...' });
        // Assuming we use an element acting as a spinner, potentially with a role or specific class/aria-label
        // Alternatively, we can check for an element that represents loading
        const spinner = screen.getByRole('status') || screen.getByTestId('loading-spinner');
        expect(spinner).toBeInTheDocument();
    });

    it('has overlay styling classes', () => {
        const { container } = render(LoadingOverlay, { message: 'Loading...' });
        // Check for backdrop-blur or absolute positioning classes
        // This is a bit implementation detail dependent, but ensures we are applying overlay styles
        const overlay = container.firstElementChild;
        expect(overlay).toHaveClass('absolute', 'inset-0', 'backdrop-blur-sm');
    });
});
