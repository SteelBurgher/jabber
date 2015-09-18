var path = require('path');
var express = require('express');
var ws = require('ws');
var minimist = require('minimist');
var url = require('url');
var kurento = require('kurento-client');
var Recording = require('../api/recording/recording.model');
var mongoose = require('mongoose');

var argv = minimist(process.argv.slice(2), {
  default: {
      as_uri: "http://localhost:9000/",
      ws_uri: "ws://localhost:8888/kurento"
  }
});

var kurentoClient = null;
var userRegistry = new UserRegistry();
var pipelines = {};

// Represents users connected to play socket
function UserSession(id, name, ws) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.sdpOffer = null;
}

UserSession.prototype.sendMessage = function(message) {
    this.ws.send(JSON.stringify(message));
}

// Represents registrar of users
function UserRegistry() {
    this.usersById = {};
    this.usersByName = {};
}

UserRegistry.prototype.register = function(user) {
    this.usersById[user.id] = user;
    this.usersByName[user.name] = user;
}

UserRegistry.prototype.unregister = function(id) {
    var user = this.getById(id);
    if (user) delete this.usersById[id]
    if (user && this.getByName(user.name)) delete this.usersByName[user.name];
}

UserRegistry.prototype.getById = function(id) {
    return this.usersById[id];
}

UserRegistry.prototype.getByName = function(name) {
    return this.usersByName[name];
}

UserRegistry.prototype.removeById = function(id) {
    var userSession = this.usersById[id];
    if (!userSession) return;
    delete this.usersById[id];

    delete this.usersByName[userSession.name];
}

function PlayMediaPipeline() {
    this.pipeline = null;
    this.webRtcEndpoint = null;
    this.playerEndpoint = null;
}

// Recover kurentoClient for the first time.
    function getKurentoClient(callback) {
        if (kurentoClient !== null) {
            return callback(null, kurentoClient);
        }

        kurento(argv.ws_uri, function(error, _kurentoClient) {
            if (error) {
                var message = 'Coult not find media server at address ' + argv.ws_uri;
                return callback(message + ". Exiting with error " + error);
            }

            kurentoClient = _kurentoClient;
            callback(null, kurentoClient);
        });
    }

PlayMediaPipeline.prototype.createPipeline = function(userId, ws, url, callback) {
    var self = this;
    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }

        kurentoClient.create('MediaPipeline', function(error, pipeline) {
            if (error) {
                return callback(error);
            }

            pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
                if (error) {
                    pipeline.release();
                    return callback(error);
                }

                if (candidatesQueue[userId]) {
                    while(candidatesQueue[userId].length) {
                        var candidate = candidatesQueue[userId].shift();
                        webRtcEndpoint.addIceCandidate(candidate);
                    }
                }

                webRtcEndpoint.on('OnIceCandidate', function(event) {
                    var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
                    ws.send(JSON.stringify({
                        id : 'iceCandidate',
                        candidate : candidate
                    }));
                });


                pipeline.create('PlayerEndpoint', {uri: url}, function(error, playerEndpoint) {
                    if (error) {
                        pipeline.release();
                        return callback(error);
                    }

                    playerEndpoint.on("EndOfStream", function() {
                        console.log('ended');
                        ws.send(JSON.stringify({
                            id : 'playEnd'
                        }));
                    });

                    playerEndpoint.on("Error", function() {
                        console.log('error occurred');
                    })

                    playerEndpoint.connect(webRtcEndpoint, function(error) {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }

                        self.pipeline = pipeline;
                        self.webRtcEndpoint = webRtcEndpoint;
                        self.playerEndpoint = playerEndpoint;
                        callback(null);
                    });
                });
            });
        });
    });
}

PlayMediaPipeline.prototype.play = function() {
    var self = this;
    this.playerEndpoint.play();
};

PlayMediaPipeline.prototype.generateSdpAnswer = function(sdpOffer, callback) {
    this.webRtcEndpoint.processOffer(sdpOffer, callback);
    this.webRtcEndpoint.gatherCandidates(function(error) {
        if (error) {
            return callback(error);
        }
    });
};

module.exports = function (server) {

    var wss = new ws.Server({
        server : server,
        path : '/play'
    });


    // upon connection with a client, a unique session ID is created for this socket connection
    // the sessionID can be accessed from within the 'error', 'close', and 'message' event handlers
    wss.on('connection', function(ws) {
        
        var sessionId;

        // informs of a connection error
        ws.on('error', function(error) {
            console.log('Connection ' + sessionId + ' error');
            stop(sessionId);
        });


    

        ws.on('close', function() {
            console.log('Connection ' + sessionId + ' closed');
            stop(sessionId);
            userRegistry.unregister(sessionId);
        });

        ws.on('message', function(_message) {
            var message = JSON.parse(_message);
            console.log('Connection ' + sessionId + ' received message ', message);

            switch (message.id) {

            case 'stop':
                stop(sessionId);
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.candidate);
                break;

            case 'onPlayIceCandidate':
                onPlayIceCandidate(sessionId, message.candidate);
                break;

            case 'play':
                play(sessionId, message);
                break;

            case 'readyToPlay':
                startPlaying(sessionId);
                break;

            case 'setUserId':
                sessionId = message.userId;
                register(sessionId, message.name, ws);
                break;
            
            default:

                ws.send(JSON.stringify({
                    id : 'error',
                    message : 'Invalid message ' + message
                }));
                break;
            }

        });

        // sends open message to client so client knows to send unique userid
        ws.send(JSON.stringify({
            id: 'open'
        }));
    });

    function play(sessionId, message) {

        var user = userRegistry.getById(sessionId); // get User Session object of the requested recording
        clearCandidatesQueue(sessionId); // clear ICE candidates made from previous call
        var socket = userRegistry.getById(sessionId).ws; // get socket connection of the requesting user 
        if(socket) {
            var pipeline = new PlayMediaPipeline();
            pipelines[sessionId] = pipeline;

            console.log('found user!')
            pipeline.createPipeline(sessionId, socket, message.url, function(error) {
                if (error) {
                    return onError(error, error);
                }
                console.log('Created Player Pipeline!');
                pipeline.generateSdpAnswer(message.sdpOffer, function(error, sdpAnswer) {
                    if (error) {
                        return onError(error, error);
                    }

                    console.log('Generated SDP Answer!');
                    var responseMessage = {
                        id: 'playResponse',
                        response : 'accepted',
                        sdpAnswer: sdpAnswer
                    };

                    socket.send(JSON.stringify(responseMessage));

                });
            });
            
        }
    }

    function startPlaying(sessionId) {
        if (!pipelines[sessionId]) {
            return;
        }
        pipelines[sessionId].play();
    }

    

    function stop(sessionId) {
        if (!pipelines[sessionId]) {
            return;
        }

        var pipeline = pipelines[sessionId]; // sessionIds are stored in global pipelines object
        delete pipelines[sessionId]; // session deleted from local storage
        pipeline.release(); // pipeline released (practically deleted) in Kurento Media server 

        clearCandidatesQueue(sessionId);
    }

    function register(id, name, ws, callback) {
        function onError(error) {
            ws.send(JSON.stringify({id:'registerResponse', response : 'rejected ', message: error}));
        }

        if (!name) {
            return onError("empty user name");
        }

        if (userRegistry.getById(id)) {
            return onError("User " + id + " is already registered");
        }

        userRegistry.register(new UserSession(id, name, ws));
        try {
            ws.send(JSON.stringify({id: 'registerResponse', response: 'accepted'}));
        } catch(exception) {
            onError(exception);
        }
    }

    function clearCandidatesQueue(sessionId) {
        if (candidatesQueue[sessionId]) {
            delete candidatesQueue[sessionId];
        }
    }

    function onIceCandidate(sessionId, _candidate) {
        var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
        var user = userRegistry.getById(sessionId);

        if (pipelines[user.id] && pipelines[user.id].webRtcEndpoint && pipelines[user.id].webRtcEndpoint[user.id]) {
            var webRtcEndpoint = pipelines[user.id].webRtcEndpoint[user.id];
            webRtcEndpoint.addIceCandidate(candidate);
        }
        else {
            if (!candidatesQueue[user.id]) {
                candidatesQueue[user.id] = [];
            }
            candidatesQueue[sessionId].push(candidate);
        }
    }

    function onPlayIceCandidate(sessionId, _candidate) {
        var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
        var user = userRegistry.getById(sessionId);

        if (pipelines[user.id] && pipelines[user.id].webRtcEndpoint && pipelines[user.id].webRtcEndpoint[user.id]) {
            var webRtcEndpoint = pipelines[user.id].webRtcEndpoint[user.id];
            webRtcEndpoint.addIceCandidate(candidate);
        }
        else {
            if (!candidatesQueue[user.id]) {
                candidatesQueue[user.id] = [];
            }
            candidatesQueue[sessionId].push(candidate);
        }
    }


}