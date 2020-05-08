const express = require('express');
const FileSync = require('lowdb/adapters/FileSync');
const uuid = require('uuid');
const redis = require('redis');
const rejson = require('redis-rejson');
const { promisify } = require('util');

const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
rejson(redis);
const client = redis.createClient();
const lifespan = 2 * 60;

redis.Multi.prototype.exec = promisify(redis.Multi.prototype.exec);
const _keys = promisify(client.keys).bind(client);
const _hget = promisify(client.hget).bind(client);
const _hset = promisify(client.hset).bind(client);
const _lrange = promisify(client.lrange).bind(client);
const _rpush = promisify(client.rpush).bind(client);
const _lindex = promisify(client.lindex).bind(client);

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }))

const getPeople = async () => {
  const batch = client.batch();
  const queue = await _lrange('queue', 0, -1);
  queue.forEach(k => batch.json_get(`q:${k}`));
  return (await batch.exec()).map(JSON.parse);
}

const exists = async (id) => {
  const queue = await _lrange('queue', 0, -1);
  return queue.includes(id);
}

app.get('/admin', async (req, res) => {
  res.render('admin', {
    people: await getPeople()
  });
})

app.get('/', async (req, res) => {
  res.render('signup', {
    success: false,
    error: '',
    people: await getPeople()
  })
})

app.get('/api/queue', async (req, res) => {
  res.json({
    people: await getPeople()
  });
});

app.post('/', async (req, res) => {
  if (!req.body.name) {
    return;
  }

  const uid = uuid.v1();
  const data = {
    name: req.body.name,
    complete: false,
    current: false,
    joined: new Date(),
    id: uid
  };
  _rpush('queue', uid);
  client.json_set(`q:${uid}`, '.', JSON.stringify(data));

  res.render('signup', {
    success: true,
    error: '',
    people: await getPeople()
  });
});


app.post('/current', async (req, res) => {
  const { id } = req.body;
  if (!exists(id)) {
    return res.status(400).end();
  }

  const people = await getPeople();
  const isCurrent = people.find(person => person.current);
  if (isCurrent) {
    isCurrent.current = false;
    client.json_set(`q:${isCurrent.id}`, '.', JSON.stringify(isCurrent));

    // toggling current person
    if (isCurrent.id === id) {
      return res.json({
        people: await getPeople()
      });
    }
  }

  const nextCurrent = people.find(person => person.id === id);
  if (nextCurrent) {
    nextCurrent.current = true;
    client.json_set(`q:${nextCurrent.id}`, '.', JSON.stringify(nextCurrent));
  }

  return res.json({
    people: await getPeople()
  });
});


app.post('/complete', async (req, res) => {
  const { id } = req.body;
  if (!exists(id)) {
    return res.status(400).end();
  }

  const people = await getPeople();
  const person = people.find(person => person.id === id);
  if (person) {
    person.complete = true;
    person.current = false;
    client.json_set(`q:${person.id}`, '.', JSON.stringify(person));
  }

  return res.json({
    people: await getPeople()
  });
});


app.post('/remove', async (req, res) => {
  const { id } = req.body;
  if (!exists(id)) {
    return res.status(400).end();
  }

  client.del(`q:${id}`);
  client.lrem('queue', 1, id);

  return res.json({
    people: await getPeople()
  });
});


const getCreatures = async (ignore = '') => {
    const keys = await _keys('u:*');
    const cursor = client.batch();
    keys.forEach(k => { if (k !== ignore) cursor.json_get(k); });
    const res = (await cursor.exec()).map(r => JSON.parse(r));
    return res;
}

const getActivities = async () => {
  const keys = await _keys('a:*');
  const cursor = client.batch();
  keys.forEach(k => cursor.json_get(k));
  const res = (await cursor.exec()).map((r) => {
    return { ts: Date.now(), ...JSON.parse(r)};
  });
  return res;
}

io.on('connection', async socket => {
  console.log('socket connected...');

  socket.on('clickEvt', async data => {
    const k = `a:${data.id}:${data.evtIdx}`;
    data = { created: Date.now(), lifespan, ...data};
    client.json_set(k, '.', JSON.stringify(data));
    client.expire(k, lifespan);
    socket.broadcast.emit('activity', data);
  });

  // broadcast curent events
  const activity = await getActivities();
  socket.emit('activity', activity);

  socket.on('frame', async data => {
    const k = `u:${data.id}`;
    client.json_set(k, '.', JSON.stringify(data));
    client.expire(k, 15);
    const creatures = await getCreatures();
    socket.emit('pong', creatures);
  });
});

server.listen(3500);
