const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const canvas = require('canvas');
const sqlite3 = require('sqlite3').verbose();

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Configuration and Setup
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

const app = express();
const PORT = 3000;

const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

/*
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    Handlebars Helpers

    Handlebars helpers are custom functions that can be used within the templates 
    to perform specific tasks. They enhance the functionality of templates and 
    help simplify data manipulation directly within the view files.

    In this project, two helpers are provided:
    
    1. toLowerCase:
       - Converts a given string to lowercase.
       - Usage example: {{toLowerCase 'SAMPLE STRING'}} -> 'sample string'

    2. ifCond:
       - Compares two values for equality and returns a block of content based on 
         the comparison result.
       - Usage example: 
            {{#ifCond value1 value2}}
                <!-- Content if value1 equals value2 -->
            {{else}}
                <!-- Content if value1 does not equal value2 -->
            {{/ifCond}}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
*/

// Set up Handlebars view engine with custom helpers
//
app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', './views');

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Middleware
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.use(
    session({
        secret: 'oneringtorulethemall',     // Secret key to sign the session ID cookie
        resave: false,                      // Don't save session if unmodified
        saveUninitialized: false,           // Don't create session until something stored
        cookie: { secure: false },          // True if using https. Set to false for development without https
    })
);

app.use((req, res, next) => {
    res.locals.appName = 'MicroBlog';
    res.locals.copyrightYear = 2024;
    res.locals.postNeoType = 'Post';
    res.locals.loggedIn = req.session.loggedIn || false;
    res.locals.userId = req.session.userId || '';
    next();
});

app.use(express.static('public'));                  // Serve static files
app.use(express.urlencoded({ extended: true }));    // Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.json());                            // Parse JSON bodies (as sent by API clients)

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Routes
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Home route: render home view with posts and user
app.get('/', async (req, res) => {
    const posts = await getPosts();
    const user = await getCurrentUser(req);
    res.render('home', { posts, user });
});

// Register GET route
app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error });
});

// Login route GET route
app.get('/login', (req, res) => {
    res.render('loginRegister', { loginError: req.query.error });
});

// Error route
app.get('/error', (req, res) => {
    res.render('error');
});

// Profile route
app.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const user = await getCurrentUser(req);
        if (!user) {
            return res.redirect('/login');
        }

        db.all('SELECT * FROM posts WHERE username = ?', [user.username], (err, userPosts) => {
            if (err) {
                console.error(err.message);
                res.redirect('/error');
            } else {
                const deletedPost = req.session.deletedPost || null;
                req.session.deletedPost = null;
                res.render('profile', { user, posts: userPosts, deletedPost });
            }
        });
    } catch (error) {
        console.error(error.message);
        res.redirect('/error');
    }
});

// Post routes
app.post('/posts', isAuthenticated, async (req, res) => {
    const { title, content } = req.body;
    const user = await getCurrentUser(req);
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO posts (title, content, username, timestamp, likes) VALUES (?, ?, ?, ?, 0)', [title, content, user.username, timestamp], (err) => {
        if (err) {
            console.error(err.message);
            res.redirect('/error');
        } else {
            res.redirect('/');
        }
    });
});

// Like post route
app.post('/like/:id', isAuthenticated, async (req, res) => {
    const postId = parseInt(req.params.id, 10);
    try {
        const post = await findPostById(postId);
        const user = await getCurrentUser(req);
        if (post && post.username !== user.username) {
            db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [postId], (err) => {
                if (err) {
                    console.error(err.message);
                    res.redirect('/error');
                } else {
                    res.redirect('back');
                }
            });
        } else {
            res.redirect('back');
        }
    } catch (error) {
        console.error(error.message);
        res.redirect('/error');
    }
});


// Delete post route
app.post('/delete/:id', isAuthenticated, async (req, res) => {
    const postId = parseInt(req.params.id, 10);
    const user = await getCurrentUser(req);
    db.run('DELETE FROM posts WHERE id = ? AND username = ?', [postId, user.username], (err) => {
        if (err) {
            console.error(err.message);
            res.redirect('/error');
        } else {
            req.session.deletedPost = 'Post deleted successfully';
            res.redirect('/profile');
        }
    });
});

// Register POST route
app.post('/register', async (req, res) => {
    const { username } = req.body;
    try {
        const userExists = await findUserByUsername(username);
        if (userExists) {
            return res.redirect('/register?error=Username%20already%20exists');
        }
        addUser(username);
        res.redirect('/login');
    } catch (error) {
        console.error(error.message);
        res.redirect('/error');
    }
});

// Login POST route
app.post('/login', async (req, res) => {
    const { username } = req.body;
    try {
        const user = await findUserByUsername(username);
        if (!user) {
            return res.redirect('/login?error=Invalid%20username');
        }
        req.session.userId = user.id;
        req.session.loggedIn = true;
        res.redirect('/');
    } catch (error) {
        console.error(error.message);
        res.redirect('/error');
    }
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect('/error');
        }
        res.redirect('/');
    });
});

// Avatar generation route
app.get('/avatar/:username', (req, res) => {
    const { username } = req.params;
    const avatar = generateAvatar(username[0]);
    res.set('Content-Type', 'image/png');
    res.send(avatar);
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Server Activation
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Support Functions and Variables
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Example data for users
let users = [
    { id: 1, username: 'SampleUser', avatar_url: undefined, memberSince: '2024-01-01 08:00' },
    { id: 2, username: 'AnotherUser', avatar_url: undefined, memberSince: '2024-01-02 09:00' },
];

// Function to find a user by username
function findUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) {
                return reject(err);
            }
            resolve(row);
        });
    });
}

// Function to find a user by user ID
function findUserById(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
            if (err) {
                return reject(err);
            }
            resolve(row);
        });
    });
}

// Function to add a new user
function addUser(username) {
    const newUser = {
        id: users.length + 1,
        username,
        avatar_url: undefined,
        memberSince: new Date().toISOString(),
    };
    users.push(newUser);
    db.run('INSERT INTO users (username, memberSince) VALUES (?, ?)', [username, newUser.memberSince], (err) => {
        if (err) {
            console.error(err.message);
        }
    });
}

// Function to get the current user from session
function getCurrentUser(req) {
    return new Promise((resolve, reject) => {
        findUserById(req.session.userId).then(user => {
            resolve(user);
        }).catch(err => {
            console.error(err.message);
            resolve(null);
        });
    });
}

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

function findPostById(postId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM posts WHERE id = ?', [postId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}


// Function to get all posts, sorted by latest first
function getPosts() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM posts ORDER BY timestamp DESC', (err, rows) => {
            if (err) {
                return reject(err);
            }
            resolve(rows);
        });
    });
}

// Function to generate an image avatar
const { createCanvas } = require('canvas');

function generateAvatar(letter, width = 100, height = 100) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#007bff';
    ctx.fillRect(0, 0, width, height);
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter.toUpperCase(), width / 2, height / 2);
    return canvas.toBuffer();
}
