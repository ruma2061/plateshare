
const { expect } = require('chai');
const validateRegistration = require('../src/validateRegistration');

describe('Registration Validation', () => {

  it('rejects a password shorter than 8 characters', () => {
    const error = validateRegistration({
      username: 'testuser',
      password: 'abc123'
    });

    expect(error).to.equal('Password must be at least 8 characters.');
  });

  it('rejects an invalid username', () => {
    const error = validateRegistration({
      username: 'ab',
      password: 'password123'
    });

    expect(error).to.include('Username must be 3-20 characters');
  });

  it('accepts valid registration information', () => {
    const error = validateRegistration({
      username: 'testuser',
      password: 'password123'
    });

    expect(error).to.be.null;
  });

});
