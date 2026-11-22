import { describe, expect, it } from 'vitest';
import { canonicalUrl, jsonLdScript, plainText, SITE_URL } from './seo';

describe('canonicalUrl', () => {
    it('keeps the root as a bare slash', () => {
        expect(canonicalUrl('/')).toBe(`${SITE_URL}/`);
    });

    it('gives one page one spelling, whatever the trailing slash', () => {
        expect(canonicalUrl('/sources/spotify')).toBe(`${SITE_URL}/sources/spotify`);
        expect(canonicalUrl('/sources/spotify/')).toBe(`${SITE_URL}/sources/spotify`);
    });
});

describe('plainText', () => {
    it('drops the guides inline emphasis', () => {
        expect(plainText('Tick <strong>Extended streaming history</strong>.')).toBe(
            'Tick Extended streaming history.'
        );
    });

    it('resolves the entities the catalog writes', () => {
        expect(plainText('when it&rsquo;s ready &mdash; Account &rarr; Data')).toBe(
            "when it's ready — Account → Data"
        );
    });

    it('collapses the whitespace a multi-line literal leaves behind', () => {
        expect(plainText('one\n    two')).toBe('one two');
    });
});

describe('jsonLdScript', () => {
    it('cannot end the script block it is embedded in', () => {
        const escaped = jsonLdScript({ text: 'end</script><script>alert(1)</script>' });
        expect(escaped).not.toContain('</script>');
        expect(JSON.parse(escaped).text).toBe('end</script><script>alert(1)</script>');
    });
});
