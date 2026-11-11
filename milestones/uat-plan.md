# PlateShare User Acceptance Test Plan

## 1. Scope and Requirements

This team plan covers three project features and their user-facing requirements:

1. **User registration / account creation:** A visitor can register with a unique valid username and a password of at least eight characters, and receives useful feedback when registration information is invalid.
2. **Recipe creation (planned feature):** An authenticated user can create a recipe and see the saved content; incomplete submissions are rejected with understandable feedback. This feature is under development; test details and acceptance criteria must be checked against the implementation before UAT execution.
3. **Private profiles and follow requests:** A user can request access to a private account, the account owner can approve that request, and private content remains restricted until approval.

These feature-level requirements are the user stories/requirements being evaluated. Replace or supplement them with the team's formal user-story IDs if those exist elsewhere in the project documentation.

## 2. Acceptance Criteria

- **Registration:** A valid unique username (3–20 letters, digits, or underscores) and password (at least 8 characters) creates an account and redirects to login; a shorter password displays a clear validation message and does not create the account.
- **Recipe creation (planned):** A signed-in user can save a recipe with its title, ingredients, and directions, and subsequently view those details. Missing a required field prevents creation and produces identifiable feedback. Confirm exact required fields before UAT execution.
- **Private profiles:** An unapproved user can submit a follow request and the owner can accept it; private recipe and profile content is not exposed before approval.

## 3. Environment and Setup

- **Application:** PlateShare
- **Test environment:** Locally running application and PostgreSQL 17 using the project's development Docker Compose setup, not the disposable automated-test database.
- **Setup:** Start the project's documented development services; load the required schema; open PlateShare in the browser; prepare two distinct test accounts for private-profile cases. Confirm the working application URL and record it at execution.
- **Browser/device:** Google Chrome on a desktop or laptop computer.
- **Application version/commit to test:** To be recorded at execution (`git rev-parse --short HEAD`).
- **Execution date:** The project testing milestone date in the team schedule; record the actual date when testing occurs.

## 4. Testers

- **Intended users:** Students or other people who use recipe-sharing websites, preferably outside the PlateShare implementation team.
- **Recruitment and coordination:** PlateShare team coordinates volunteers and sets up test accounts.
- **Planned tester IDs:** T1 and T2. Use these IDs instead of recording unnecessary personal information.
- **Limitations:** If classmates on the implementation team must act as testers, document this limitation when tests are executed.

## 5. UAT Test Cases

| Test ID | Feature / requirement | Acceptance criterion | Preconditions | Test data | User steps | Expected result | Tester ID | Actual result | Status | Issue / follow-up |
|---|---|---|---|---|---|---|---|---|---|---|
| UAT-01 | Registration / create account | A valid new account can be created and then used to log in. | User is signed out; registration page is open; username is unused. | Username: `uat_testuser01`; password: `TestPassword123` | 1. Open registration. 2. Enter the test username. 3. Enter the password. 4. Submit. 5. Log in using the same credentials. | Registration redirects to the login page; login with the new credentials succeeds. | Planned: T1 | Not run | Not run | None yet |
| UAT-02 | Registration / reject invalid input | A password shorter than 8 characters is rejected with a specific explanation. | User is signed out; registration page is open; username is unused. | Username: `uat_testuser02`; password: `abc123` | 1. Open registration. 2. Enter the test username. 3. Enter the short password. 4. Submit. 5. Attempt to log in with those credentials. | A password-length error is shown; registration does not complete; login with those credentials is unsuccessful. | Planned: T1 | Not run | Not run | None yet |
| UAT-03 | Recipe creation / save valid recipe **(planned)** | A signed-in user can save a complete recipe and view the submitted details. | Recipe creation feature is implemented; user is logged in; recipe form is available. | Title: `Chocolate Chip Cookies`; ingredients: `flour, sugar, chocolate chips, butter`; directions: `Mix ingredients and bake at 350°F for 12 minutes.`; fill any other required fields with valid data. | 1. Open recipe creation. 2. Enter title. 3. Enter ingredients. 4. Enter directions. 5. Complete any other required fields. 6. Save. 7. Open the created recipe. | A new recipe is saved and can be opened; displayed title, ingredients, and directions match submitted information. | Planned: T2 | Not run | Not run | Feature under development; confirm form and fields before execution |
| UAT-04 | Recipe creation / reject incomplete recipe **(planned)** | A missing required field prevents recipe creation and is explained to the user. | Recipe creation feature is implemented; user is logged in; recipe form is available. | Title: `Incomplete Recipe Test`; leave the required directions field empty (or update to the actual required field once implemented). | 1. Open recipe creation. 2. Enter the title. 3. Leave the selected required field blank. 4. Submit. 5. Check the user's recipe list for the incomplete recipe. | The incomplete recipe is not created; the form identifies the missing required information. | Planned: T2 | Not run | Not run | Feature under development; confirm which field is required before execution |
| UAT-05 | Private profiles / approve follow request | A private account owner can approve a request and give that follower access. | Two accounts exist; account B is private; account A is not following B. | Account A: `uat_follower`; account B: `uat_private` | 1. Log in as A. 2. Open B's profile. 3. Request to follow. 4. Log out and log in as B. 5. Open follow requests. 6. Accept A's request. 7. Log in as A and reopen B's profile. | B sees A's pending request and can approve it; afterward A can see content available to approved followers. | Planned: T1 | Not run | Not run | None yet |
| UAT-06 | Private profiles / deny unapproved access | Private content remains restricted for a non-follower. | Account B is private; account A is signed in but has not been approved as B's follower. | Account A: `uat_follower`; account B: `uat_private`; B has at least one private recipe. | 1. Log in as A. 2. Open B's profile. 3. Attempt to view B's private recipes, including a direct recipe URL. | B's private recipe contents do not appear in A's profile views; the direct private recipe URL is denied or returns not found. | Planned: T1 | Not run | Not run | None yet |

## 6. Execution and Follow-up

This document is the **plan** required for Lab 10; none of these UAT cases has been executed yet. Execute them during the project testing milestone, after the relevant features are available. Record the actual application commit, test date, and observed results. Update each status to **Pass**, **Fail**, or **Blocked**; document any issue, corrective action, and retest result. Include completed observations in the final project report. Do not record simulated or invented results.
