(() => {
  const feed = document.querySelector('[data-discover-feed]');
  if (!feed) return;
  const status = document.querySelector('[data-feed-status]');
  let loading = false;
  let autoLoad = true;
  let observer;

  // Relative URLs inherit HTTPS in deployment and HTTP on local development.
  // Reject redirects before following them, and never send tokens cross-origin.
  async function request(url, options, consume) {
    if (new URL(url, location.href).origin !== location.origin) throw new Error('Invalid request destination.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        ...options, mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
        cache: 'no-store', signal: controller.signal,
      });
      if (response.status === 401) throw new Error('Your session expired. Refresh the page to sign in.');
      if (response.status === 403) throw new Error('This form expired. Refresh the page and try again.');
      if (response.status === 404) throw new Error('This recipe is no longer available.');
      if (!response.ok) throw new Error('The request failed. Please try again.');
      return await consume(response);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The request timed out. Please try again.');
      if (error instanceof TypeError) throw new Error('Could not connect. Please try again or refresh the page.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function watchNext() {
    observer?.disconnect();
    const next = feed.querySelector('[data-feed-next]');
    if (next && autoLoad) observer?.observe(next);
  }

  async function loadMore() {
    const next = feed.querySelector('[data-feed-next]');
    if (!next || loading) return;
    loading = true;
    observer?.disconnect();
    feed.setAttribute('aria-busy', 'true');
    status.textContent = 'Loading more recipes…';
    const hadFocus = document.activeElement === next;
    try {
      const url = new URL(next.href);
      url.pathname = '/discover/feed';
      const html = await request(url, { headers: { Accept: 'text/html' } }, response => {
        if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Unexpected response. Please refresh the page.');
        return response.text();
      });
      const page = new DOMParser().parseFromString(html, 'text/html');
      const batch = page.querySelector('[data-feed-batch]');
      if (!batch) throw new Error('Unexpected response. Please refresh the page.');
      const existing = new Set(Array.from(feed.querySelectorAll('[data-recipe-id]'), post => post.dataset.recipeId));
      for (const post of batch.querySelectorAll('[data-recipe-id]')) {
        if (existing.has(post.dataset.recipeId)) post.remove();
      }
      const count = batch.querySelectorAll('[data-recipe-id]').length;
      feed.querySelector('[data-feed-pagination]').remove();
      feed.append(batch);
      if (hadFocus) {
        const target = batch.querySelector('h2 a') || batch.querySelector('a');
        target?.focus({ preventScroll: true });
      }
      status.textContent = count ? `${count} more recipes loaded.` : "You're all caught up.";
      autoLoad = true;
      checkImages();
    } catch (error) {
      autoLoad = false; // Avoid request storms; retry only after an explicit click.
      status.textContent = `${error.message} Use “Load more recipes” to retry.`;
    } finally {
      loading = false;
      feed.setAttribute('aria-busy', 'false');
      watchNext();
    }
  }

  feed.addEventListener('click', event => {
    if (event.target.closest('[data-feed-next]') && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault();
      loadMore();
    }
  });

  feed.addEventListener('submit', async event => {
    const form = event.target.closest('[data-feed-save]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button');
    if (button.disabled) return;
    const message = form.closest('article').querySelector('[data-save-status]');
    button.disabled = true;
    message.textContent = '';
    try {
      const { isSaved } = await request(form.action, {
        method: 'POST', headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)),
      }, async response => {
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected response. Please refresh the page.');
        const result = await response.json();
        if (typeof result.isSaved !== 'boolean') throw new Error('Unexpected response. Please refresh the page.');
        return result;
      });
      form.action = form.action.replace(/\/(?:un)?save$/, isSaved ? '/unsave' : '/save');
      button.textContent = isSaved ? 'Saved · Remove' : 'Save recipe';
      button.setAttribute('aria-pressed', String(isSaved));
      button.setAttribute('aria-label', isSaved ? `Remove ${form.dataset.title} from saved recipes` : `Save ${form.dataset.title}`);
      message.textContent = isSaved ? 'Added to My Recipes.' : 'Removed from My Recipes.';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  function checkImages() {
    feed.querySelectorAll('img').forEach(img => {
      if (img.complete && !img.naturalWidth) img.hidden = true;
    });
  }
  feed.addEventListener('error', event => {
    if (event.target.tagName === 'IMG') event.target.hidden = true;
  }, true);
  checkImages();
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: '600px 0px' });
    watchNext();
  }
})();
