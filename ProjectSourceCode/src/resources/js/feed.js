// Friends feed (#15): load the next batch of cards when the reader nears the
// bottom. Without JavaScript the "Load more" link still pages normally.
(() => {
  const list = document.querySelector('[data-feed]');
  const more = document.querySelector('[data-feed-more]');
  const end = document.querySelector('[data-feed-end]');
  const status = document.querySelector('[data-feed-status]');
  if (!list || !more || !window.fetch) return;

  let loading = false;
  let observer = null;

  const announce = message => { if (status) status.textContent = message; };

  function finish() {
    if (observer) observer.disconnect();
    more.parentElement.remove();
    if (end) end.hidden = false;
  }

  async function loadNext() {
    if (loading || !more.isConnected) return;
    loading = true;
    more.setAttribute('aria-busy', 'true');
    more.textContent = 'Loading…';

    try {
      const url = new URL(more.href, window.location.href);
      url.searchParams.set('partial', '1');
      const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
      // An expired session redirects to the login page; send the reader there.
      if (response.redirected || !response.ok) {
        if (response.redirected) window.location.assign(more.href);
        throw new Error(`Feed request failed: ${response.status}`);
      }

      const template = document.createElement('template');
      template.innerHTML = (await response.text()).trim();
      const cards = [...template.content.querySelectorAll('.feed-item')];
      cards.forEach(card => card.classList.add('is-new'));
      list.append(...cards);
      announce(cards.length ? `Loaded ${cards.length} more ${cards.length === 1 ? 'update' : 'updates'}.` : '');

      const next = response.headers.get('X-Feed-Next');
      if (!next) return finish();
      more.href = next;
      more.textContent = 'Load more';
      // Re-check in case the new cards still leave the link on screen.
      if (observer) { observer.unobserve(more); observer.observe(more); }
    } catch (error) {
      console.error(error);
      more.textContent = 'Try again';
    } finally {
      loading = false;
      more.removeAttribute('aria-busy');
    }
  }

  more.addEventListener('click', event => {
    event.preventDefault();
    loadNext();
  });

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadNext();
    }, { rootMargin: '0px 0px 600px 0px' });
    observer.observe(more);
  }
})();
