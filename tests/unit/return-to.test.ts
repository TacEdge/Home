import { describe, expect, it } from 'vitest';
import { localPath } from '@/app/_forms/return-to';

// A return address bound by a page is input: only a parsed, same-origin
// local path is followed; everything else goes to the fallback.

describe('localPath', () => {
  it('keeps a local path with its query', () => {
    expect(localPath('/tasks', '/x')).toBe('/tasks');
    expect(localPath('/home/projects/abc?undo=1', '/x')).toBe('/home/projects/abc?undo=1');
    expect(localPath('/a/../b', '/x')).toBe('/b'); // normalised
  });
  it('refuses anything that is not a local path on this site', () => {
    for (const bad of [
      undefined,
      '',
      'tasks',
      'https://evil.example/',
      '//evil.example/x',
      '/\\evil.example',
      '\\\\evil.example',
      '/\tevil.example',
      '/x\u0000y',
      '/x y',
      'javascript:alert(1)',
      `/${'a'.repeat(3000)}`,
    ]) {
      expect(localPath(bad, '/fallback'), String(bad)).toBe('/fallback');
    }
  });
});
