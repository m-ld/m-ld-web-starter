const express = require('express');
const socket = require('socket.io');
const { join } = require('path');
const { IoRemotesService } = require('@m-ld/m-ld/dist/socket.io-server');

const app = express();
const staticFiles = ['/', '/bundle.js', '/index.html'];
app.get(staticFiles, (req, res) => {
  res.sendFile(join(__dirname, req.path.split('/').slice(-1)[0] || 'index.html'));
});

const httpServer = require('http').createServer(app);
const port = 3000;
httpServer.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});

const io = new socket.Server(httpServer);
new IoRemotesService(io.sockets)
  .on('error', console.error)
  .on('debug', console.debug);

const formIds = new Set;
app.get('/form/:id', (req, res) => {
  res.cookie('is-genesis', !formIds.has(req.params.id))
    .sendFile(join(__dirname, 'form.html'));
  formIds.add(req.params.id);
});
