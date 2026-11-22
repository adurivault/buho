import { describe, expect, it } from 'vitest';
import { resolveCssVars } from './cssVars';

const tokens: Record<string, string> = {
    '--foreground': '40 16% 90%',
    '--background': '30 9% 7%',
    '--empty': '',
};

const resolve = (name: string) => tokens[name] ?? '';

describe('resolveCssVars', () => {
    it('substitutes a token into a colour function', () => {
        expect(resolveCssVars('hsl(var(--foreground))', resolve)).toBe('hsl(40 16% 90%)');
    });

    it('keeps the rest of the markup intact', () => {
        expect(
            resolveCssVars('<path fill="hsl(var(--foreground) / 0.18)" d="M0,0H10Z"/>', resolve)
        ).toBe('<path fill="hsl(40 16% 90% / 0.18)" d="M0,0H10Z"/>');
    });

    it('substitutes every occurrence', () => {
        expect(resolveCssVars('a:var(--foreground);b:var(--background)', resolve)).toBe(
            'a:40 16% 90%;b:30 9% 7%'
        );
    });

    it('falls back when the token is unknown', () => {
        expect(resolveCssVars('var(--nope, 1px solid red)', resolve)).toBe('1px solid red');
    });

    it('falls back through a nested var()', () => {
        expect(resolveCssVars('hsl(var(--popover, var(--background)))', resolve)).toBe(
            'hsl(30 9% 7%)'
        );
    });

    it('treats a token defined as empty as absent', () => {
        expect(resolveCssVars('var(--empty, gold)', resolve)).toBe('gold');
    });

    it('collapses an unknown token with no fallback, as a browser does', () => {
        expect(resolveCssVars('fill:var(--nope);', resolve)).toBe('fill:;');
    });

    it('leaves text without any var() untouched', () => {
        expect(resolveCssVars('<text>var</text>', resolve)).toBe('<text>var</text>');
    });

    it('does not lose the tail of an unbalanced expression', () => {
        expect(resolveCssVars('hsl(var(--foreground', resolve)).toBe('hsl(var(--foreground');
    });
});
