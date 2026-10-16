import katex from 'katex';

const htmlCache = new Map<string, string>();
const renderedElements = new WeakMap<Element, { latex: string; html: string }>();
let cachedCharacters = 0;

export function renderFormulaInto(element: Element, latex: string): void {
  const previous = renderedElements.get(element);
  if (previous?.latex === latex && element.innerHTML === previous.html) return;
  let html = htmlCache.get(latex);
  if (html === undefined) {
    html = katex.renderToString(latex, { displayMode: true, throwOnError: false });
    if (html.length <= 1_000_000) {
      htmlCache.set(latex, html);
      cachedCharacters += html.length;
      while (htmlCache.size > 128 || cachedCharacters > 2_000_000) {
        const oldest = htmlCache.keys().next().value!;
        cachedCharacters -= htmlCache.get(oldest)!.length;
        htmlCache.delete(oldest);
      }
    }
  }
  if (element.innerHTML !== html) element.innerHTML = html;
  renderedElements.set(element, { latex, html });
}
