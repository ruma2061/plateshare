
function validateRegistration({ username, password }) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return 'Username must be 3-20 characters and only use letters, numbers, or underscores.';
  }

  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  return null;
}

module.exports = validateRegistration;
