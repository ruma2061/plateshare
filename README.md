# PlateShare

PlateShare is a web app where users log the meals they cook or eat out, save and share recipes, and follow friends to see what they're making in a social feed.

## What you can do
- make an account and log in
- post a dish with a photo, ingredients, steps, and a rating
- like, comment on, and save other people's posts
- follow friends and see their posts in your feed
- search recipes by ingredient, cuisine, or dietary tag

(still a work in progress, right now login/register works and the rest is being built)

## Running it locally

You need Docker Desktop installed and running.

1. cd into `ProjectSourceCode`
```
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="pwd"
POSTGRES_DB="plateshare_db"
```
3. run `docker compose up`
4. open http://localhost:3000

The .env is gitignored so don't try to commit it.

If someone changes `src/init_data/create.sql` your db won't update on its own. Reset it with:
```
docker compose down -v
docker compose up
```
(this deletes everything in your local db)

## Where stuff is
- `ProjectSourceCode/src/index.js` - server and routes
- `ProjectSourceCode/src/views` - the pages (handlebars)
- `ProjectSourceCode/src/init_data` - database tables
- `MilestoneSubmissions` - project docs
- `TeamMeetingLogs` - meeting notes

## Contributing
Make your own branch, don't push to main. Open a PR and get someone to review it before merging.
