// Recover broken user-provided images with a bundled photo, without inline handlers.
document.querySelectorAll('[data-recipe-photo]').forEach(image => {
  function useFallback() {
    const fallback = image.dataset.fallbackSrc;
    if (!fallback || image.getAttribute('src') === fallback) return;
    image.src = fallback;
    image.alt = image.dataset.fallbackAlt;
    const caption = image.closest('.recipe-image')?.querySelector('.recipe-image-caption');
    if (caption) caption.hidden = false;
  }
  image.addEventListener('error', useFallback, { once: true });
  // A cached/bad image may already have failed before this deferred script runs.
  if (image.complete && image.naturalWidth === 0) useFallback();
});
