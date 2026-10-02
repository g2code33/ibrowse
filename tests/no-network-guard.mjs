import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

function blocked(name) {
  return function blockedNetwork() {
    throw new Error(`network disabled for tests: ${name}`);
  };
}
net.connect = blocked('net.connect');
net.createConnection = blocked('net.createConnection');
tls.connect = blocked('tls.connect');
http.request = blocked('http.request');
http.get = blocked('http.get');
https.request = blocked('https.request');
https.get = blocked('https.get');
if (globalThis.fetch) {
  globalThis.fetch = blocked('fetch');
}
