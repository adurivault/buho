import '@testing-library/svelte/vitest';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock Worker for jsdom
const WorkerMock = class {
    constructor() { }
    postMessage = vi.fn();
    terminate = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
} as any;

vi.stubGlobal('Worker', WorkerMock);

// Global Mock for IntersectionObserver
const IntersectionObserverMock = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn();
};

vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

// Global Mock for ResizeObserver
const ResizeObserverMock = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
};

vi.stubGlobal('ResizeObserver', ResizeObserverMock);
