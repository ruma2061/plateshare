
# PlateShare — Lab 10 Testing

## Test Environment

- Node.js 22
- PostgreSQL 17
- Mocha 10.8.2
- Chai 4.5.0
- Chai HTTP 4.4.0
- Isolated Docker test database: `project_test`

The test environment uses `docker-compose.test.yaml` to keep testing separate from the development database.

## Setup

From the `ProjectSourceCode` directory:

1. Create your local test environment file:

   ```bash
   cp .env.test.example .env.test
   ```

2. Edit `.env.test` and configure the test database password and session secret. Use the same test database password configured for the Docker environment.

3. Start the test database:

   ```bash
   docker compose -p plateshare-lab10 -f docker-compose.test.yaml up -d db-test
   ```

4. Install dependencies in the test container if this is the first run:

   ```bash
   docker compose -p plateshare-lab10 -f docker-compose.test.yaml run --rm --no-deps tests npm ci
   ```

5. Run the automated test suite:

   ```bash
   docker compose -p plateshare-lab10 -f docker-compose.test.yaml run --rm --no-deps tests npm test
   ```

6. Repeat the test command to verify that all tests pass without manual database cleanup.

The actual `.env.test` file must not be committed to GitHub. Only `.env.test.example` should be committed.

## Registration Route Contract

**Endpoint:** `POST /register`

### Valid input

- Username: 3–20 characters consisting of letters, numbers, or underscores
- Password: At least 8 characters

### Expected responses

- Valid registration: HTTP 302, redirects to `/login`
- Invalid registration: HTTP 400, displays a validation error
- Duplicate username: HTTP 409

### Database behavior

- Valid registration inserts exactly one matching user into the `users` table.
- Passwords are stored as bcrypt hashes rather than plaintext.
- Invalid registration does not insert a user.

## Welcome Route Contract

**Endpoint:** `GET /welcome`

### Expected response

- HTTP status: 200
- Content type: JSON

Expected response body:

```json
{
  "status": "success",
  "message": "Welcome!"
}
```

## Automated Test Coverage

### Unit Tests — `validation.spec.js`

1. Rejects passwords shorter than 8 characters.
2. Rejects usernames that do not meet validation requirements.
3. Accepts valid registration information.

### Integration Tests — `server.spec.js`

4. Verifies that `GET /welcome` returns HTTP 200 and the expected JSON response.
5. Verifies successful registration, HTTP 302 redirect, exactly one matching database record, and bcrypt password hashing.
6. Verifies that invalid registration returns HTTP 400 and does not insert a database record.

### Extra Credit — Private Follow Requests

7. Verifies that an authenticated user can submit a follow
   request to a private account, creating one pending request
   without automatically creating a follow relationship.

8. Verifies that an unauthenticated user is redirected to login
   and no follow request or follow relationship is created.

Both tests use the isolated PostgreSQL test database and
clean up their test accounts and relationships after execution.

## Test Data and Cleanup

The integration tests use a separate PostgreSQL test database.

Registration tests use designated usernames:

- `lab10_valid_user`
- `lab10_invalid_user`

The tests remove only records associated with these usernames before and after execution.

The tests do not truncate application tables or modify the development database.

The test suite requires no manual database cleanup between runs.

## Test Results

The expected result is:

```text
8 passing
```

Run the test suite twice consecutively and confirm that all eight tests pass on both runs.

## User Acceptance Testing

The team UAT plan is located at:

`../../milestones/uat-plan.md`

It covers three project features with successful-task and invalid-input or alternate-path test cases.

The plan is submitted with Lab 10. Actual UAT execution results will be recorded during the project testing milestone.

## Additional Test Runner

The project also contains existing tests using Node.js's built-in test runner.

These can be run separately using:

```bash
npm run test:node
```

The Lab 10 Mocha test suite runs using:

```bash
npm test
```
