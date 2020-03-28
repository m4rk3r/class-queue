const express = require('express');
const FileSync = require('lowdb/adapters/FileSync');
const lowdb = require('lowdb');
const uuid = require('uuid');
const redis = require('redis');
const rejson = require('redis-rejson');
const { promisify } = require('util');

const adapter = new FileSync('queue.db');
const app = express();
const db = lowdb(adapter);
const server = require('http').Server(app);
const io = require('socket.io')(server);
rejson(redis);
const client = redis.createClient();

redis.Multi.prototype.exec = promisify(redis.Multi.prototype.exec);
const _keys = promisify(client.keys).bind(client);

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
    .push({ name: req.body.name, complete: false, current: false, joined: new Date(), id: uuid.v1() })
    .write();

  res.render('signup', {
    success: true,
    error: '',
    people: getPeople()
  });
});


app.post('/current', function (req, res) {
  const { id } = req.body;
  const exists = db.get('queue').find({ id }).value();

  if (!exists) {
    return res.status(400).end();
  }

  db.get('queue')
    .find({ current: true })
    .assign({ current: false })
    .write();

  db.get('queue')
    .find({ id })
    .assign({ current: true })
    .write();

  return res.json({
    people: getPeople()
  });
});


app.post('/complete', function (req, res) {
  const { id } = req.body;
  const exists = db.get('queue').find({ id }).value();

  if (!exists) {
    return res.status(400).end();
  }

  db.get('queue')
    .find({ id })
    .assign({ complete: true, current: false })
    .write();

  return res.json({
    people: getPeople()
  });
});


const getCreatures = async (ignore = '') => {
    const keys = await _keys('u:*');
    const cursor = client.batch();
    keys.forEach(k => { if (k !== ignore) cursor.json_get(k); });
    const res = (await cursor.exec()).map(r => JSON.parse(r));
    return res;
}

io.on('connection', socket => {
  console.log('socket connected...');

  socket.on('frame', async data => {
    const k = `u:${data.id}`;
    client.json_set(k, '.', JSON.stringify(data));
    client.expire(k, 15);
    const creatures = await getCreatures();
    socket.emit('pong', creatures);
  });
});

server.listen(3500);
