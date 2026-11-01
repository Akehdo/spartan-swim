/** Text enters in short, staggered waves. Every element reveals just once. */
export function initMotion() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return { refresh() {} };

  const headingSelector = '.hero h1, .section-heading h2, .coach-copy h2';
  const unitSelector = [
    '.hero-description', '.hero-actions', '.hero-visual',
    '.coach-portrait-wrap', '.coach-intro', '.coach-copy>.button',
    '.schedule-toolbar', '.schedule-card', '.schedule-footnote',
    '.footer-top',
  ].join(', ');

  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      target.classList.add('is-visible');
      observer.unobserve(target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });

  function splitHeading(heading) {
    if (heading.querySelector('.reveal-word')) return;
    const label = heading.innerText.replace(/\s+/g, ' ').trim();
    heading.classList.add('reveal-heading');
    // Screen readers get the complete phrase, rather than separate words.
    heading.setAttribute('aria-label', label);
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let index = 0;
    for (const node of nodes) {
      const fragment = document.createDocumentFragment();
      for (const token of node.textContent.split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token)) fragment.append(document.createTextNode(token));
        else {
          const word = document.createElement('span');
          word.className = 'reveal-word';
          word.setAttribute('aria-hidden', 'true');
          word.style.setProperty('--word-index', Math.min(index++, 12));
          word.textContent = token;
          fragment.append(word);
        }
      }
      node.replaceWith(fragment);
    }
  }

  function watch(element) {
    if (element.classList.contains('is-visible')) return;
    observer.observe(element);
  }

  function refresh(root = document) {
    if (reducedMotion.matches) {
      // A live preference change can happen while edited sheet text is loading.
      root.querySelectorAll(headingSelector).forEach(heading => {
        if (heading.hasAttribute('aria-label')) heading.setAttribute('aria-label', heading.innerText.replace(/\s+/g, ' ').trim());
      });
      return;
    }
    root.querySelectorAll(headingSelector).forEach(heading => {
      splitHeading(heading);
      watch(heading);
    });
    root.querySelectorAll(unitSelector).forEach(element => {
      element.classList.add('reveal-unit');
      // Siblings arrive in a short sequence; long lists never delay reading.
      const siblings = [...element.parentElement.children].filter(child => child.matches(unitSelector));
      const index = Math.max(0, siblings.indexOf(element));
      element.style.setProperty('--reveal-delay', `${Math.min(index, 3) * 85}ms`);
      watch(element);
    });
  }

  reducedMotion.addEventListener('change', event => {
    if (!event.matches) return;
    observer.disconnect();
    document.querySelectorAll('.reveal-heading, .reveal-unit').forEach(element => element.classList.add('is-visible'));
  });

  try { refresh(); }
  catch {
    // A motion failure must never hide the page's content or controls.
    observer.disconnect();
    document.querySelectorAll('.reveal-heading, .reveal-unit').forEach(element => element.classList.add('is-visible'));
  }
  return { refresh };
}
