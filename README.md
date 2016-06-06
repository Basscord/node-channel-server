# node-channel-server
Node.js Channel Server

Refactor of EricssonResearch's openwebrtc channel server.

Compatible with the channel server from this revision: 
https://github.com/EricssonResearch/openwebrtc-examples/blob/8f7b847b5f2d0a267ef1eaea5f8b2f405af6a120/web/channel_server.js

## Starting the server
The server uses [node.js](http://nodejs.org) and is started using:
```
node channel_server.js
```
The default port is 8080. The port to use can be changed by setting the environment variable PORT or giving the port as an argument to the node command. If both the environment variable and the argument are given then the argument is used.

