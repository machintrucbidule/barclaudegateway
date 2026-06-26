import { describe, expect, it } from 'vitest';
import { describeRuntime } from './index.js';

describe('describeRuntime', () => {
  it('reports the application version', () => {
    expect(describeRuntime()).toContain('v0.0.1');
  });

  it('includes the provided Chronodrive API version', () => {
    expect(describeRuntime('1.4.0')).toContain('1.4.0');
  });
});
