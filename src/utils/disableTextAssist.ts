// Names in this app (alleles, genes, strains) are case-sensitive and not
// words, so the system's auto-capitalisation, autocorrect, spell-check and
// autocomplete must stay off - on macOS the webview applies the user's own
// Keyboard settings to every text field and turned "ox" into "Ox".
// One observer sets this on every text field, including ones added later,
// rather than each input repeating the attributes.
const TEXT_FIELDS =
  'input:not([type]), input[type="text"], input[type="search"], textarea';

const ATTRIBUTES: Array<[string, string]> = [
  ['autocomplete', 'off'],
  ['autocorrect', 'off'],
  ['autocapitalize', 'off'],
  ['spellcheck', 'false'],
];

const apply = (field: Element): void => {
  for (const [name, value] of ATTRIBUTES) {
    if (field.getAttribute(name) !== value) field.setAttribute(name, value);
  }
};

const applyWithin = (node: Node): void => {
  if (!(node instanceof Element)) return;
  if (node.matches(TEXT_FIELDS)) apply(node);
  node.querySelectorAll(TEXT_FIELDS).forEach(apply);
};

/** Turns the text assists off for every text field in `root`, now and later. */
export const disableTextAssist = (root: Node = document.body): (() => void) => {
  applyWithin(root);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(applyWithin);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
};
