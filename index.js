const express = require('express');
const FileSync = require('lowdb/adapters/FileSync');
const lowdb = require('lowdb');

const adapter = new FileSync('queue.db');
const app = express();
const db = lowdb(adapter);

db.defaults({ queue: [] })
  .write();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }))

const getPeople = () => db.get('queue').sortBy('complete').value()

app.get('/admin', function (req, res) {
  res.render('admin', {
    people: getPeople()
  });
})

app.get('/', function (req, res) {
  res.render('signup', {
    success: false,
    error: '',
    people: getPeople()
  })
})

app.get('/api/queue', (req, res) => {
  res.json({
    people: getPeople()
  });
});

app.post('/', function (req, res) {
  if (!req.body.name) {
    return;
  }

  db.get('queue')
    .push({ name: req.body.name, complete: false, joined: new Date() })
    .write();

  res.render('signup', {
    success: true,
    error: '',
    people: getPeople()
  });
});

app.post('/complete', function (req, res) {
  const exists = db.get('queue').find({ name: req.body.name }).value();

  if (!exists) {
    return res.status(400).end();
  }

  db.get('queue')
    .find({ name: req.body.name })
    .assign({ complete: true })
    .write();

  return res.status(200).end();
})

app.listen(3500);
