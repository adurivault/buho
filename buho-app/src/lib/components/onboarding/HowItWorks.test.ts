import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, expect, test } from 'vitest';
import HowItWorks from './HowItWorks.svelte';

/** The step a caption belongs to — `now` marks the one being animated. */
const stepOf = (caption: RegExp) => screen.getByText(caption).closest('li');

describe('the how-it-works diagram', () => {
    /**
     * The diagram is decorative and the three steps are the content. If motion
     * were the only thing saying what happens, the page would be empty to a
     * screen reader, empty with reduced motion on, and empty in the half-second
     * before hydration.
     */
    test('states all three steps as text, whatever is moving', () => {
        render(HowItWorks);

        expect(screen.getByText(/Request your data/i)).toBeInTheDocument();
        expect(screen.getByText(/Open it in Buho/i)).toBeInTheDocument();
        expect(screen.getByText(/^Explore$/)).toBeInTheDocument();
    });

    /**
     * Each step gets its own sentences. The first version explained only the
     * asking and left the reading and the looking to a caption apiece, which
     * made the one paragraph on the page describe one third of the product.
     */
    test('says something concrete about each of the three', () => {
        render(HowItWorks);

        expect(screen.getByText(/have to give you a copy/i)).toHaveTextContent(
            /form or a button in their settings/i
        );
        expect(screen.getByText(/Drop the file here/i)).toHaveTextContent(/nothing is uploaded/i);
        expect(screen.getByText(/filter, search and zoom/i)).toHaveTextContent(/across ten years/i);
    });

    test('starts on the first step', () => {
        render(HowItWorks);

        expect(stepOf(/Request your data/i)).toHaveClass('now');
        expect(stepOf(/^Explore$/)).not.toHaveClass('now');
    });

    /**
     * The escape hatch, tested because it is the whole reason the prop exists:
     * if the looping version does not hold attention, the funnel takes the
     * diagram over and advances it one station per step.
     */
    test('can be driven from outside instead of cycling', () => {
        render(HowItWorks, { props: { beat: 2 } });

        expect(stepOf(/^Explore$/)).toHaveClass('now');
        expect(stepOf(/Request your data/i)).not.toHaveClass('now');
    });

    test('is hidden from assistive tech, since the steps already say it', () => {
        const { container } = render(HowItWorks);

        expect(container.querySelector('svg.diagram')).toHaveAttribute('aria-hidden', 'true');
    });
});
