// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars'); //to enable express to work with handlebars
const Handlebars = require('handlebars'); // to include the templating engine responsible for compiling templates
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part C.

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
});

// database configuration
const dbConfig = {
  host: 'db', // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful'); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************

// TODO - Include your API routes here
app.get('/', (req, res) => {
  res.redirect('/login'); 
});

app.get('/register', (req, res) => {
    res.render('pages/register');
});

app.get('/login', (req, res) => {
    res.render('pages/login');
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Logout failed');
    }
    res.render('pages/logout', {
      message: 'Logged out Successfully'
    });
  });
});


const auth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};

app.get('/discover', auth, async (req, res) => {
  try {
    const response = await axios.get(
      'https://app.ticketmaster.com/discovery/v2/events.json',
      {
        params: {
          apikey: process.env.API_KEY,
          keyword: 'music',
          size:10
        }
      }
    );

    const events = response.data._embedded?.events || [];

    const results = events.map(event => ({
      name: event.name,
      image: event.images?.[0]?.url || 'https://placehold.co/400x250',
      date: event.dates?.start?.localDate || 'N/A',
      time: event.dates?.start?.localTime || 'N/A',
      url: event.url
    }));
    res.render('pages/discover', {results});

  } catch (err) {
    console.error(err);
    res.render('pages/discover', {
      results: [],
      message: "Unable to load events.",
      error: true
    });
  }
});

app.post('/login', async (req, res) => {
  try {
    const username = req.body.username;
    const password = req.body.password;
    const user = await db.oneOrNone(
        'SELECT * FROM users WHERE username = $1',
        [username]        
    );
    if (!user) {
        return res.redirect('/register');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
        return res.render('pages/login', {
            message: 'Incorrect username or password.',
            error: true
        });
    }
    req.session.user = { username: user.username };
    req.session.save((err) => {
        if (err) {
            return res.status(500).send('Session error');
        }
        res.redirect('/discover');
    });
  } catch (err) {
    console.error(err)
    res.status(500).render('pages/login', {
      message: 'An error occurred while logging in.',
      error: true
    });
  }
});
app.post('/register', async (req, res) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 10);
    await db.none(
    'INSERT INTO users (username, password) VALUES ($1, $2);',
    [req.body.username, hash]
    );
    res.redirect('/login');
  } catch (error) {
    console.error(error);
    res.status(500).send('Registration Failed');
  }
});

// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
app.listen(3000);
console.log('Server is listening on port 3000');