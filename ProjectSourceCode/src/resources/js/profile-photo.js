(() => {
  const photo = document.querySelector('[data-profile-photo]');
  if (!photo) return;
  const input = photo.querySelector('[data-photo-input]');
  const dropzone = photo.querySelector('[data-photo-dropzone]');
  const preview = photo.querySelector('[data-photo-preview]');
  const placeholder = photo.querySelector('[data-photo-placeholder]');
  const status = photo.querySelector('[data-photo-status]');
  const remove = photo.querySelector('[data-photo-remove]');
  const form = photo.closest('form');
  const url = form.querySelector('[data-photo-url]');
  const savedPhoto = preview.getAttribute('src') || '';
  let previewUrl;
  let dragDepth = 0;

  function showPreview(source) {
    preview.hidden = !source;
    placeholder.hidden = Boolean(source);
    if (source) preview.src = source;
    else preview.removeAttribute('src');
  }

  function resetPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    showPreview(remove.checked ? '' : savedPhoto);
  }

  function choosePhoto(files) {
    if (!files.length) return;
    const file = files[0];
    if (files.length !== 1 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      || file.size === 0 || file.size > 5 * 1024 * 1024) {
      input.value = '';
      resetPreview();
      status.textContent = 'Choose one JPG, PNG, or WebP photo up to 5 MB.';
      status.classList.add('text-danger');
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    remove.checked = false;
    showPreview(previewUrl);
    status.textContent = `${file.name} is ready. Select Save profile to use this photo.`;
    status.classList.remove('text-danger');
  }

  input.addEventListener('change', () => {
    if (input.files.length) choosePhoto(input.files);
    else resetPreview();
  });
  dropzone.addEventListener('dragenter', event => {
    event.preventDefault();
    dragDepth += 1;
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  dropzone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropzone.classList.remove('is-dragging');
  });
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-dragging');
    if (!event.dataTransfer?.files.length) return;
    // Assign dropped files to the real input so the standard form upload works.
    try { input.files = event.dataTransfer.files; }
    catch {
      status.textContent = 'Use Choose photo to select this file in your browser.';
      return;
    }
    choosePhoto(input.files);
  });
  remove.addEventListener('change', () => {
    if (remove.checked) {
      input.value = '';
      url.value = '';
    }
    resetPreview();
    status.classList.remove('text-danger');
    status.textContent = remove.checked ? 'Your photo will be removed when you save.' : 'Your current photo is unchanged.';
  });
  preview.addEventListener('error', () => {
    preview.hidden = true;
    placeholder.hidden = false;
    if (previewUrl) {
      input.value = '';
      resetPreview();
      status.textContent = 'This photo could not be opened. Choose a different image.';
      status.classList.add('text-danger');
    }
  });
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Saving…';
  });
  window.addEventListener('pageshow', () => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = false;
    button.textContent = 'Save profile';
  });
  window.addEventListener('pagehide', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
})();
