import { afterEach, describe, expect, test } from 'vitest';
import { disableTextAssist } from './disableTextAssist';

describe('disableTextAssist', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    document.body.innerHTML = '';
  });

  const expectOff = (field: Element): void => {
    expect(field.getAttribute('autocapitalize')).toBe('off');
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
  };

  test('turns the assists off on the text fields already on the page', () => {
    document.body.innerHTML =
      '<input id="a" type="text"><input id="b"><textarea id="c"></textarea><input id="n" type="number">';
    stop = disableTextAssist();
    expectOff(document.getElementById('a') as Element);
    expectOff(document.getElementById('b') as Element);
    expectOff(document.getElementById('c') as Element);
    expect(document.getElementById('n')?.hasAttribute('autocapitalize')).toBe(
      false
    );
  });

  test('also covers fields added later, including nested ones', async () => {
    stop = disableTextAssist();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<div><input id="late" type="text"></div>';
    document.body.appendChild(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectOff(document.getElementById('late') as Element);
  });
});
