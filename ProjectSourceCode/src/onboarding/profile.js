function parseProfileDetails(body = {}) {
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
  const avatarUrl = typeof body.avatar_url === 'string' ? body.avatar_url.trim() : '';

  if (displayName.length < 2 || displayName.length > 60) {
    throw new Error('Display name must be 2-60 characters.');
  }
  if (bio.length > 280) {
    throw new Error('Bio must be 280 characters or less.');
  }
  if (avatarUrl.length > 2000) {
    throw new Error('Photo URL is too long.');
  }
  if (avatarUrl) {
    let parsed;
    try { parsed = new URL(avatarUrl); } catch { throw new Error('Enter a valid photo URL.'); }
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('Photo URL must be a public HTTPS image URL.');
    }
  }
  return { displayName, bio: bio || null, avatarUrl: avatarUrl || null };
}

module.exports = { parseProfileDetails };
