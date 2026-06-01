import { describe, expect, it } from 'vitest';
import { buildPersonas, type Persona } from './personas.js';

describe('personas', () => {
  let personas: Persona[];

  // Build once — the list is deterministic.
  personas = buildPersonas();

  // ---------------------------------------------------------------------------
  // Structure
  // ---------------------------------------------------------------------------

  describe('structure', () => {
    it('produces exactly 60 personas', () => {
      expect(personas).toHaveLength(60);
    });

    it('assigns sequential 0-based indices', () => {
      for (let i = 0; i < personas.length; i++) {
        expect(personas[i].index).toBe(i);
      }
    });

    it('every persona has a non-empty slug', () => {
      for (const p of personas) {
        expect(p.slug).toBeTruthy();
        expect(typeof p.slug).toBe('string');
        expect(p.slug.trim().length).toBeGreaterThan(0);
      }
    });

    it('every persona has a non-empty opener', () => {
      for (const p of personas) {
        expect(typeof p.opener).toBe('string');
        expect(p.opener.length).toBeGreaterThan(0);
        if (p.archetype !== 'minimal') {
          expect(p.opener.trim().length, `persona ${p.slug} has blank opener`).toBeGreaterThan(0);
        }
      }
    });

    it('every persona has at least one followUp', () => {
      for (const p of personas) {
        expect(Array.isArray(p.followUps)).toBe(true);
        expect(p.followUps.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('every persona has a non-empty archetype', () => {
      for (const p of personas) {
        expect(p.archetype).toBeTruthy();
        expect(typeof p.archetype).toBe('string');
      }
    });

    it('all followUps are non-empty strings', () => {
      for (const p of personas) {
        for (const fu of p.followUps) {
          expect(typeof fu).toBe('string');
          expect(fu.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Uniqueness
  // ---------------------------------------------------------------------------

  describe('uniqueness', () => {
    it('all slugs are unique', () => {
      const slugs = personas.map((p) => p.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('all openers are unique', () => {
      const openers = personas.map((p) => p.opener);
      expect(new Set(openers).size).toBe(openers.length);
    });

    it('slugs contain only filename-safe characters', () => {
      for (const p of personas) {
        expect(p.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Archetype coverage
  // ---------------------------------------------------------------------------

  describe('archetype coverage', () => {
    const EXPECTED_ARCHETYPES = ['story', 'exploratory', 'power', 'edge', 'docs', 'ad', 'minimal'];

    it('covers all expected archetypes', () => {
      const present = new Set(personas.map((p) => p.archetype));
      for (const arch of EXPECTED_ARCHETYPES) {
        expect(present.has(arch), `missing archetype: ${arch}`).toBe(true);
      }
    });

    it('has 10 story personas', () => {
      expect(personas.filter((p) => p.archetype === 'story')).toHaveLength(10);
    });

    it('has 10 exploratory personas', () => {
      expect(personas.filter((p) => p.archetype === 'exploratory')).toHaveLength(10);
    });

    it('has 10 power personas', () => {
      expect(personas.filter((p) => p.archetype === 'power')).toHaveLength(10);
    });

    it('has 10 edge personas', () => {
      expect(personas.filter((p) => p.archetype === 'edge')).toHaveLength(10);
    });

    it('has 5 docs personas', () => {
      expect(personas.filter((p) => p.archetype === 'docs')).toHaveLength(5);
    });

    it('has 5 ad personas', () => {
      expect(personas.filter((p) => p.archetype === 'ad')).toHaveLength(5);
    });

    it('has 10 minimal personas', () => {
      expect(personas.filter((p) => p.archetype === 'minimal')).toHaveLength(10);
    });
  });

  // ---------------------------------------------------------------------------
  // Bilingual coverage
  // ---------------------------------------------------------------------------

  describe('bilingual coverage', () => {
    it('includes at least one Chinese (zh) persona', () => {
      const zhPersonas = personas.filter(
        (p) => p.slug.startsWith('zh-') || /[一-鿿]/.test(p.opener),
      );
      expect(zhPersonas.length).toBeGreaterThanOrEqual(1);
    });

    it('Chinese personas have Chinese followUps', () => {
      const zhPersonas = personas.filter(
        (p) => p.slug.startsWith('zh-') || /[一-鿿]/.test(p.opener),
      );
      for (const p of zhPersonas) {
        const hasChinese = p.followUps.some((fu) => /[一-鿿]/.test(fu));
        expect(hasChinese, `persona ${p.slug} lacks Chinese followUps`).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Edge case persona properties
  // ---------------------------------------------------------------------------

  describe('edge case personas', () => {
    it('edge personas exercise adversarial patterns', () => {
      const edgePersonas = personas.filter((p) => p.archetype === 'edge');
      const slugs = edgePersonas.map((p) => p.slug);
      expect(slugs.some((s) => s.includes('empty') || s.includes('blank'))).toBe(true);
    });

    it('exploratory personas are intentionally vague', () => {
      const exploratory = personas.filter((p) => p.archetype === 'exploratory');
      const shortOpeners = exploratory.filter((p) => p.opener.length < 50);
      expect(shortOpeners.length).toBeGreaterThan(0);
    });

    it('power personas reference specific workflows or tools', () => {
      const power = personas.filter((p) => p.archetype === 'power');
      const toolTerms = ['shot-list', 'script', 'batch', 'clone', 'export', 'workflow', 'canvas', 'preset', 'style'];
      const referencesTool = power.filter((p) =>
        toolTerms.some((t) => p.opener.toLowerCase().includes(t) || p.slug.includes(t)),
      );
      expect(referencesTool.length).toBeGreaterThan(0);
    });

    it('minimal personas have extremely short openers', () => {
      const minimal = personas.filter((p) => p.archetype === 'minimal');
      expect(minimal.length).toBe(10);
      const shortOpeners = minimal.filter((p) => p.opener.trim().length <= 30);
      expect(shortOpeners.length).toBeGreaterThanOrEqual(8);
    });

    it('minimal personas include near-empty inputs', () => {
      const minimal = personas.filter((p) => p.archetype === 'minimal');
      const nearEmpty = minimal.filter(
        (p) => p.opener.trim().length <= 3,
      );
      expect(nearEmpty.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Immutability
  // ---------------------------------------------------------------------------

  describe('immutability', () => {
    it('buildPersonas returns a fresh array on each call', () => {
      const a = buildPersonas();
      const b = buildPersonas();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('mutating returned array does not affect subsequent calls', () => {
      const a = buildPersonas();
      a.pop();
      const b = buildPersonas();
      expect(b).toHaveLength(60);
    });
  });
});
