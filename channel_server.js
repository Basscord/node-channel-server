
USERS_IN_SESSION_LIMIT = 2;

function ChannelServer () {

    var http = require("http"); // https?
    var server = http.createServer();
    
    this.port = process.env.PORT || 8080;

    // getPort
    if (process.argv.length > 2) {
        this.port = process.argv[2];
    }

    this.sessions = {};

    server.on("request", this.requestListener.bind(this));
    server.listen(this.port);

    server.on('listening', function() {
        console.log('Server started on port %s at %s', server.address().port, server.address().address);
    });
}

ChannelServer.prototype.getSession = function(id) {
    return this.sessions[id];
}

ChannelServer.prototype.addSession = function(id, session) {
    this.sessions[id] = session;
}

ChannelServer.prototype.requestListener = function(request, response) {
    new RequestListener(request, response);
}

function RequestListener(request, response) {

    this.parts = request.url.split("/");
    this.communicationType = this.parts[1]; // Communication type
    this.sessionId = this.parts[2]; // roomID
    this.userId = this.parts[3]; // UUID

    // Legacy URL Support:
    if (this.communicationType === "ctos") {
        this.communicationType = "client-to-client-via-server"; // Client sends custom message to other client, via server
    } else if (this.communicationType === "stoc") {
        this.communicationType = "server-to-client"; // Server sends event to client; e.g. busy, join, leave, roomCount.
    }

    // Bail if invalid communication type:
    if (!this.communicationType === "client-to-client-via-server" &&
        !this.communicationType === "server-to-client" &&
        !this.communicationType === "decline") {
        return;
    }

    // Close the session if we don't have a sessionId or a userId. This is different than just an early return. This closes the socket
    if (!this.sessionId || !this.userId) {
        response.writeHead(400);
        response.end();
        return;
    }

    this.request = request;
    this.response = response;
    this.go();
}

RequestListener.prototype.go = function() {

    this.headers = {
        "Cache-Control": "no-cache, no-store",
        "Pragma": "no-cache",
        "Expires": "0"
    };

    this.session = channelServer.getSession(this.sessionId);

    if (this.communicationType === "client-to-client-via-server") {
        this.doClientToClientViaServer();
    } else if (this.communicationType === "server-to-client") {
        this.doServerToClient();
    } else if (this.communicationType === "decline") {
        this.doDecline();
    }
}

RequestListener.prototype.doClientToClientViaServer = function() {
       
    this.peerId = this.parts[4]; // the person I want to direct the message toward.
    
    if (!this.session || !(this.peer = this.session.getUser(this.peerId))) {
        this.response.writeHead(400, this.headers);
        this.response.end();
        return;
    }

    this.body = "";
    this.request.on("data", function (data) { this.body += data; }.bind(this));
    this.request.on("end", this.doEnd.bind(this));
}

RequestListener.prototype.doServerToClient = function() {

    this.initiateStream();
    Utils.keepAlive(this.response);

    if (!this.session) {
        this.session = new Session();
        channelServer.addSession(this.sessionId, this.session);
    } 

    // Check if too many users in the room already
    else if(this.session.isFull()) {
        this.response.write("event:busy\ndata:" + this.sessionId + "\n\n");
        clearTimeout(this.response.keepAliveTimer);
        this.response.end();
        return;
    }

    this.openStreamWithUser(this.session.getUser(this.userId));
    console.log("@" + this.sessionId + " - " + this.userId + " joined.");
    console.log("users in session " + this.sessionId + ": " + this.session.getUsersCount());
}

RequestListener.prototype.openStreamWithUser = function(user) {
    
    if (!user) {
        user = this.session.addUser(this.userId);
        this.session.notifyJoined(this.userId, this.response);
    }
    else if (user.stream) {
        user.stream.end();
        clearTimeout(user.stream.keepAliveTimer);
        user.stream = null; 
    }

    user.stream = this.response;

    this.response.write("event:roomCount\ndata:" + this.session.getUsersCount() + "\n\n");

    this.request.on("close", this.doClose.bind(this));
}

RequestListener.prototype.doClose = function () {
    for (var peerUserId in this.session.getUsers()) {
        if (peerUserId === this.userId)
            continue;
        var stream = this.session.getUser(peerUserId).stream;
        stream.write("event:leave\ndata:" + this.userId + "\n\n");
    }

    this.session.removeUser(this.userId);
    clearTimeout(this.response.keepAliveTimer);

    console.log("@" + this.sessionId + " - " + this.userId + " left.");
    console.log("users in session " + this.sessionId + ": " + this.session.getUsersCount());
}

RequestListener.prototype.doEnd = function () {
    var evtdata = "data:" + this.body.replace(/\n/g, "\ndata:") + "\n";
    this.peer.stream.write("event:user-" + this.userId + "\n" + evtdata + "\n");
    console.log("@" + this.sessionId + " - " + this.userId + " => " + this.peerId + " :");
}

RequestListener.prototype.doDecline = function() {
    
    this.initiateStream();

    if (!this.session) {
        return;
    } 

    // Tell each PeerName User that I have declined.
    for (var peerUserId in this.session.getUsers()) {
        var stream = this.session.getUser(peerUserId).stream;
        stream.write("event:declined\ndata:" + this.userId + "\n\n"); // Maybe Decline should be a user- event?
    }

    console.log("@" + this.sessionId + " - " + this.userId + " declined.");
}

RequestListener.prototype.initiateStream = function() {
    this.headers["Content-Type"] = "text/event-stream";
    this.response.writeHead(200, this.headers);
}

function Session() {
    this.users = {};
}

Session.prototype.getUser = function(id) {
    return this.users[id];
}

Session.prototype.getUsers = function() {
    return this.users;
}

Session.prototype.addUser = function(id) {
    this.users[id] = new User();
    return this.getUser(id);
}

Session.prototype.removeUser = function(id) {
    delete this.users[id];
}

Session.prototype.getUsersCount = function() {
    return Object.keys(this.users).length;
}

Session.prototype.isFull = function() {
    if (this.getUsersCount() >= USERS_IN_SESSION_LIMIT) {
        console.log("Session Full: (" + USERS_IN_SESSION_LIMIT + ")");
        return true;
    }
    return false;
}

Session.prototype.notifyJoined = function (userId, response) {
    
    for (var peerUserId in this.getUsers()) {
        var stream = this.getUser(peerUserId).stream;
        if (stream) {
            // Reset the 30 second keep alive interval
            clearTimeout(stream.keepAliveTimer);

            Utils.keepAlive(stream);

            // Tell that user that I joined, on their event stream
            stream.write("event:join\ndata:" + userId + "\n\n");

            // Tell me that you are also joined, on my event stream.
            response.write("event:join\ndata:" + peerUserId + "\n\n");
        }
    }
}

function User() {
    this.stream = null;
}

function Utils() {} // Static

Utils.keepAlive = function(stream) {
    stream.write(":\n");
    stream.keepAliveTimer = setTimeout(arguments.callee, 30000, stream);
}

var channelServer = new ChannelServer();
