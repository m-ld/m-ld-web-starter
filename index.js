const express = require('express');
const socket = require('socket.io');
const { join } = require('path');
const { IoRemotesService } = require('@m-ld/m-ld/dist/socket.io-server');

// Create an Express app to serve the static files and the form page (see below)
const app = express();
const staticFiles = ['/', '/bundle.js', '/index.html'];
app.get(staticFiles, (req, res) => {
  res.sendFile(join(__dirname, req.path.split('/').slice(-1)[0] || 'index.html'));
});

// Create and run an HTTP server for Express and Socket.io
const httpServer = require('http').createServer(app);
const port = 3000;
httpServer.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});

// Start the Socket.io server, and attach the m-ld message-passing service
const io = new socket.Server(httpServer);
new IoRemotesService(io.sockets)
  // The m-ld service provides some debugging information
  .on('error', console.error)
  .on('debug', console.debug);

// The server keeps track of which forms are new and which have already been created. This is used
// to tell m-ld whether the clone has a brand-new domain ('genesis'), or is expected to join an
// existing one. This information is passed to the clone engine in the browser using a cookie.
const formIds = new Set;
app.get('/form/:id', (req, res) => {
  res.cookie('is-genesis', !formIds.has(req.params.id))
    .sendFile(join(__dirname, 'form.html'));
  formIds.add(req.params.id);
});
