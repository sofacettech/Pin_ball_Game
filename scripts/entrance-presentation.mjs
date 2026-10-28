// Pull presentation from the video source at build time, so it cannot drift and
// a first visit never needs another HTML request to reveal the entrance.
export function fragment(source, selector) {
  const tokens = [...source.matchAll(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g)];
  const start = tokens.findIndex(([tag]) => !tag.startsWith('<!--') && selector.test(tag));
  if (start < 0) throw Error(`Missing shared presentation: ${selector}`);
  const tag = /^<([\w-]+)/.exec(tokens[start][0])[1];
  let depth = 0;
  for (const token of tokens.slice(start)) {
    if (new RegExp(`^<${tag}(?:\\s|>)`, 'i').test(token[0])) depth++;
    if (new RegExp(`^</${tag}\\s*>`, 'i').test(token[0]) && --depth === 0) {
      return source.slice(tokens[start].index, token.index + token[0].length);
    }
  }
  throw Error(`Unclosed shared presentation: ${selector}`);
}

export function withEntrancePresentation(template, source) {
  const sections = {
    LOADER: /\bid="site-loader"/,
    COPY: /\bid="story-copy"/,
    BRAND: /\bclass="[^"]*\bsite-brand\b/,
    NAVIGATION: /<header\b[^>]*\bsite-navigation\b/,
    ENTER: /\bid="enter"/,
  };
  for (const [key, selector] of Object.entries(sections)) {
    let html = fragment(source, selector);
    if (key === 'NAVIGATION') html = html.replace('class="play-now"', 'id="skip-game" class="play-now"');
    if (key === 'LOADER') html = html.replace(/<\/div>\s*$/, `<div class="startup-feedback"><p data-scene-status role="status">Opening the world…</p><progress data-scene-progress max="100" aria-label="World download"></progress></div></div>`);
    template = template.replace(`__SHARED_${key}__`, html);
  }
  const navigation = fragment(source, /<script\b[^>]*src="[^"]*navigation\.js/);
  return template.replace('__SHARED_NAVIGATION_MODULE__', navigation.replace('<script ', '<script id="entrance-navigation-controller" '));
}
