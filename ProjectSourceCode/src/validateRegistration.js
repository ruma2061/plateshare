
function validateRegistration({ username, password }) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return 'Username must be 3-20 characters and only use letters, numbers, or underscores.';
  }

  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  // bcrypt ignores input after 72 bytes, so reject passwords it would truncate.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Password must be at most 72 bytes.';
  }

  return null;
}

module.exports = validateRegistration;
