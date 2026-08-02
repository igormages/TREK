import { describe, it, expect } from 'vitest';
import { parseAdvisoryLevel, getDiplomatieMeta, listDiplomatieCodes } from '../../../src/services/diplomatieService';

describe('diplomatieService', () => {
  describe('getDiplomatieMeta', () => {
    it('resolves known ISO codes', () => {
      expect(getDiplomatieMeta('ES')?.slug).toBe('espagne');
      expect(getDiplomatieMeta('DE')?.slug).toBe('allemagne');
      expect(getDiplomatieMeta('US')?.slug).toBe('etats-unis');
    });

    it('returns null for unknown codes', () => {
      expect(getDiplomatieMeta('XX')).toBeNull();
    });
  });

  describe('listDiplomatieCodes', () => {
    it('covers most world countries', () => {
      const codes = listDiplomatieCodes();
      expect(codes.length).toBeGreaterThan(180);
      expect(codes).toContain('ES');
      expect(codes).toContain('JP');
      expect(codes).toContain('BR');
    });
  });

  describe('parseAdvisoryLevel', () => {
    it('detects vigilance normale (green)', () => {
      const html = '<h3>Zones de vigilance</h3><p>L\'ensemble du pays est en vigilance normale.</p>';
      expect(parseAdvisoryLevel(html)).toBe('green');
    });

    it('detects formellement déconseillé (red)', () => {
      const html = '<h3>Zones de vigilance</h3><p>La totalité du territoire est formellement déconseillée.</p>';
      expect(parseAdvisoryLevel(html)).toBe('red');
    });

    it('detects zones formellement déconseillées heading (red)', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Zones formellement déconseillées</h4><p>Frontière sud.</p>';
      expect(parseAdvisoryLevel(html)).toBe('red');
    });

    it('detects vigilance renforcée (yellow)', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Zones de vigilance renforcée (jaune sur la carte)</h4><p>Le sud.</p>';
      expect(parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('detects déconseillé sauf raison impérative (orange)', () => {
      const html = '<h3>Zones de vigilance</h3><p>Ce pays est déconseillé sauf raison impérative.</p>';
      expect(parseAdvisoryLevel(html)).toBe('orange');
    });

    it('defaults to green when vigilance section exists without explicit level', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Avertissement concernant les animaux sauvages</h4><p>Des ours.</p>';
      expect(parseAdvisoryLevel(html)).toBe('green');
    });

    it('returns unknown when no vigilance section', () => {
      expect(parseAdvisoryLevel('<p>Rien ici.</p>')).toBe('unknown');
    });
  });
});
