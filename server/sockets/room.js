var path = require('path');
var express = require('express');
var ws = require('ws');
var minimist = require('minimist');
var url = require('url');
var kurento = require('kurento-client');
var Recording = require('../api/recording/recording.model');
var mongoose = require('mongoose');
var config = require('../config/environment');

var argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: "http://localhost:9000/",
    ws_uri: "ws://localhost:8888/kurento"
  }
});

/*
 * Definition of global variables.
 */

var kurentoClient = null;
var userRegistry = new UserRegistry();
var pipelines = {};
var candidatesQueue = {};

/*
 * Definition of helper classes
 */

// Represents caller and callee sessions
function UserSession(id, name, ws, partnerId) {
  this.id = id;
  this.name = name;
  this.ws = ws;
  this.partnerId = partnerId;
  this.peer = null;
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

// Represents a B2B active call
function CallMediaPipeline() {
  this.pipeline = null;
  this.webRtcEndpoint = {};
  this.recorderEndpoint = {};
}

CallMediaPipeline.prototype.createRecordingEndpoint = function(sessionId, partnerId, callback) {
  var self = this;

  Recording.create({
    date: Date.now(),
    creator: mongoose.Types.ObjectId(sessionId),
    partner: mongoose.Types.ObjectId(partnerId)
  }, function(err, recording) {
    if (err) {
      return handleError(res, err);
    }
    self.pipeline.create('RecorderEndpoint', {
      uri: 'file://' + path.join(config.root, '/server/api/recording/uploads/' + sessionId + '-' + recording._id + '.webm'),
      mediaProfile: 'WEBM_AUDIO_ONLY'
    }, function(error, callRecorder) {

      if (error) {
        return callback(error);
      }

      self.calleeHubPort.connect(callRecorder, function(error) {
        if (error) {
          return callback(error);
        }

        self.callerHubPort.connect(callRecorder, function(error) {
          if (error) {
            return callback(error);
          }
          self.recorderEndpoint[sessionId] = callRecorder;
          callback(null);
        });
      });
    });
  });
};

CallMediaPipeline.prototype.createPipeline = function(callerId, calleeId, ws, callback) {
  var self = this;
  getKurentoClient(function(error, kurentoClient) {
    if (error) {
      return callback(error);
    }

    kurentoClient.create('MediaPipeline', function(error, pipeline) {
      if (error) {
        return callback(error);
      }

      pipeline.create('WebRtcEndpoint', function(error, callerWebRtcEndpoint) {
        if (error) {
          pipeline.release();
          return callback(error);
        }

        if (candidatesQueue[callerId]) {
          while (candidatesQueue[callerId].length) {
            var candidate = candidatesQueue[callerId].shift();
            callerWebRtcEndpoint.addIceCandidate(candidate);
          }
        }

        callerWebRtcEndpoint.on('OnIceCandidate', function(event) {
          var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
          userRegistry.getById(callerId).ws.send(JSON.stringify({
            id: 'iceCandidate',
            candidate: candidate
          }));
        });

        pipeline.create('WebRtcEndpoint', function(error, calleeWebRtcEndpoint) {
          if (error) {
            pipeline.release();
            return callback(error);
          }

          if (candidatesQueue[calleeId]) {
            while (candidatesQueue[calleeId].length) {
              var candidate = candidatesQueue[calleeId].shift();
              calleeWebRtcEndpoint.addIceCandidate(candidate);
            }
          }

          calleeWebRtcEndpoint.on('OnIceCandidate', function(event) {
            var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
            userRegistry.getById(calleeId).ws.send(JSON.stringify({
              id: 'iceCandidate',
              candidate: candidate
            }));
          });

          pipeline.create('Composite', function(error, composite) {

            if (error) {
              pipeline.release();
              return callback(error);
            }

            composite.createHubPort(function(error, callerHubPort) {

              if (error) {
                pipeline.release();
                return callback(error);
              }

              composite.createHubPort(function(error, calleeHubPort) {

                if (error) {
                  pipeline.release();
                  return callback(error);
                }

                callerWebRtcEndpoint.connect(calleeWebRtcEndpoint, function(error) {
                  if (error) {
                    pipeline.release();
                    return callback(error);
                  }

                  calleeWebRtcEndpoint.connect(callerWebRtcEndpoint, function(error) {
                    if (error) {
                      pipeline.release();
                      return callback(error);
                    }

                    callerWebRtcEndpoint.connect(callerHubPort, function(error) {
                      if (error) {
                        pipeline.release();
                        return callback(error);
                      }

                      calleeWebRtcEndpoint.connect(calleeHubPort, function(error) {
                        if (error) {
                          pipeline.release();
                          return callback(error);
                        }

                        self.pipeline = pipeline;
                        self.webRtcEndpoint[callerId] = callerWebRtcEndpoint;
                        self.webRtcEndpoint[calleeId] = calleeWebRtcEndpoint;
                        self.callerHubPort = callerHubPort;
                        self.calleeHubPort = calleeHubPort;
                        callback(null);

                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};

CallMediaPipeline.prototype.generateSdpAnswer = function(id, sdpOffer, callback) {
  this.webRtcEndpoint[id].processOffer(sdpOffer, callback);
  this.webRtcEndpoint[id].gatherCandidates(function(error) {
    if (error) {
      return callback(error);
    }
  });
}

CallMediaPipeline.prototype.release = function() {
  if (this.pipeline) this.pipeline.release();
  this.pipeline = null;
}

CallMediaPipeline.prototype.record = function(id) {
  var self = this;
  self.recorderEndpoint[id].record(function() {
    console.log('recording');
  });
};

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

PlayMediaPipeline.prototype.createPipeline = function(userId, ws, callback) {
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
          while (candidatesQueue[userId].length) {
            var candidate = candidatesQueue[userId].shift();
            webRtcEndpoint.addIceCandidate(candidate);
          }
        }

        webRtcEndpoint.on('OnIceCandidate', function(event) {
          var candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
          ws.send(JSON.stringify({
            id: 'iceCandidate',
            candidate: candidate
          }));
        });


        pipeline.create('PlayerEndpoint', {
          uri: 'file:///tmp/recording.webm'
        }, function(error, playerEndpoint) {
          if (error) {
            pipeline.release();
            return callback(error);
          }

          playerEndpoint.on("EndOfStream", function() {
            console.log('ended');
            ws.send(JSON.stringify({
              id: 'playEnd'
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


module.exports = function(server) {

  var wss = new ws.Server({
    server: server,
    path: '/one2one'
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
      stop(sessionId, true);
      userRegistry.unregister(sessionId);
    });

    ws.on('message', function(_message) {
      var message = JSON.parse(_message);
      console.log('Connection ' + sessionId + ' received message ', message);

      switch (message.id) {

        case 'call':
          call(sessionId, message.to, message.from, message.sdpOffer);
          break;

        case 'incomingCallResponse':
          incomingCallResponse(sessionId, message.from, message.callResponse, message.sdpOffer, ws);
          break;

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
          register(sessionId, message.name, ws, message.partnerId);
          break;

        case 'checkReady':
          check(message.partnerId, ws);
          break;

        case 'startRecording':
          startRecording(sessionId, message.partnerId)
          break;
        
        case 'resumeRecording':
          resumeRecording(sessionId);
          break;
        
        case 'stopRecording':
          stopRecording(sessionId);
          break;

        default:

          ws.send(JSON.stringify({
            id: 'error',
            message: 'Invalid message ' + message
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

    var user = userRegistry.getByName(message.user); // get User Session object of the requested recording
    clearCandidatesQueue(sessionId); // clear ICE candidates made from previous call
    var socket = userRegistry.getById(sessionId).ws; // get socket connection of the requesting user 
    if (socket) {
      var pipeline = new PlayMediaPipeline();
      playPipelines[sessionId] = pipeline;

      console.log('found user!')
      pipeline.createPipeline(sessionId, socket, function(error) {
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
            response: 'accepted',
            sdpAnswer: sdpAnswer
          };

          socket.send(JSON.stringify(responseMessage));

        });
      });

    }
  }

  function startPlaying(sessionId) {
    if (!playPipelines[sessionId]) {
      return;
    }
    playPipelines[sessionId].play();
  }

  function stop(sessionId, leaving) {
    if (!pipelines[sessionId]) {
      // if leaving room notify other user
      if (leaving) {
        var message = {
          id: 'userLeft'
        }
        var partner = userRegistry.getById(userRegistry.getById(sessionId).partnerId);
        // if partner is online send leaving message
        if (partner) {
          partner.sendMessage(message);
        }
      }
      return;
    }

    var pipeline = pipelines[sessionId]; // sessionIds are stored in global pipelines object
    delete pipelines[sessionId]; // session deleted from local storage
    pipeline.release(); // pipeline released (practically deleted) in Kurento Media server 
    var stopperUser = userRegistry.getById(sessionId); // gets the user object from registry of user doing the stopping
    var stoppedUser = userRegistry.getById(stopperUser.peer); // gets peer from registry
    stopperUser.peer = null; // sets peer to null

    if (stoppedUser) {
      stoppedUser.peer = null;
      delete pipelines[stoppedUser.id]; // session deleted from local storage
      if (!leaving) {
        var message = {
          id: 'stopCommunication',
          message: 'remote user ended call'
        }
        stoppedUser.sendMessage(message)
      }
    }
    if (leaving) {
      var message = {
        id: 'userLeft'
      }
      var partner = userRegistry.getById(userRegistry.getById(sessionId).partnerId);
      // if partner is online send leaving message
      if (partner) {
        partner.sendMessage(message);
      }
    }

    clearCandidatesQueue(sessionId);
  }

  function incomingCallResponse(calleeId, from, callResponse, calleeSdp, ws) {

    clearCandidatesQueue(calleeId);

    function onError(callerReason, calleeReason) {
      if (pipeline) pipeline.release();
      if (caller) {
        var callerMessage = {
          id: 'callResponse',
          response: 'rejected'
        }
        if (callerReason) callerMessage.message = callerReason;
        caller.sendMessage(callerMessage);
      }

      var calleeMessage = {
        id: 'stopCommunication'
      };
      if (calleeReason) calleeMessage.message = calleeReason;
      callee.sendMessage(calleeMessage);
    }

    var callee = userRegistry.getById(calleeId);
    if (!from || !userRegistry.getById(from)) {
      return onError(null, 'unknown from = ' + from);
    }
    var caller = userRegistry.getById(from);

    if (callResponse === 'accept') {
      var pipeline = new CallMediaPipeline();
      pipelines[caller.id] = pipeline;
      pipelines[callee.id] = pipeline;

      pipeline.createPipeline(caller.id, callee.id, ws, function(error) {
        if (error) {
          return onError(error, error);
        }

        pipeline.generateSdpAnswer(caller.id, caller.sdpOffer, function(error, callerSdpAnswer) {
          if (error) {
            return onError(error, error);
          }

          pipeline.generateSdpAnswer(callee.id, calleeSdp, function(error, calleeSdpAnswer) {
            if (error) {
              return onError(error, error);
            }

            var message = {
              id: 'startCommunication',
              sdpAnswer: calleeSdpAnswer
            };
            callee.sendMessage(message);

            message = {
              id: 'callResponse',
              response: 'accepted',
              sdpAnswer: callerSdpAnswer
            };
            caller.sendMessage(message);

          });
        });
      });
    } else {
      var decline = {
        id: 'callResponse',
        response: 'rejected',
        message: 'user declined'
      };
      caller.sendMessage(decline);
    }
  }

  function call(callerId, to, from, sdpOffer) {
    clearCandidatesQueue(callerId);

    var caller = userRegistry.getById(callerId);
    var rejectCause = 'User ' + to + ' is not registered';
    if (userRegistry.getById(to)) {
      var callee = userRegistry.getById(to);
      caller.sdpOffer = sdpOffer
      callee.peer = from;
      caller.peer = to;
      var message = {
        id: 'incomingCall',
        from: from,
        fromName: userRegistry.getById(from).name
      };
      try {
        return callee.sendMessage(message);
      } catch (exception) {
        rejectCause = "Error " + exception;
      }
    }
    var message = {
      id: 'callResponse',
      response: 'rejected: ',
      message: rejectCause
    };
    caller.sendMessage(message);
  }

  function resumeRecording(sessionId) {
    if(!pipelines[sessionId]) {
      return;
    }
    pipelines[sessionId].record(sessionId);
  }
  function stopRecording(sessionId) {
    if(!pipelines[sessionId]) {
      return;
    }
    pipelines[sessionId].recorderEndpoint[sessionId].stop(function() {
      console.log('recording stopped');
    });
  }
  function startRecording(sessionId, partnerId) {
    if(!pipelines[sessionId]) {
      return;
    }
    var pipeline = pipelines[sessionId];
    pipeline.createRecordingEndpoint(sessionId, partnerId, function(error) {
      if(error) {
        return onError(error, error);
      }

      // records only recording of user who started it
      pipeline.record(sessionId);
    });


  }
  function register(id, name, ws, partnerId) {
    function onError(error) {
      ws.send(JSON.stringify({
        id: 'registerResponse',
        response: 'rejected ',
        message: error
      }));
    }

    if (!name) {
      return onError("empty user name");
    }

    if (userRegistry.getById(id)) {
      return onError("User " + id + " is already registered");
    }

    userRegistry.register(new UserSession(id, name, ws, partnerId));
    try {
      ws.send(JSON.stringify({
        id: 'registerResponse',
        response: 'accepted'
      }));
    } catch (exception) {
      onError(exception);
    }
  }

  function check(partnerId, ws) {
    // checks if partner is active 
    var partner = userRegistry.getById(partnerId);
    if (partner) {
      ws.send(JSON.stringify({
        id: 'partnerReady'
      }));
      partner.ws.send(JSON.stringify({
        id: 'partnerReady'
      }));
    }
  };

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
    } else {
      if (!candidatesQueue[user.id]) {
        candidatesQueue[user.id] = [];
      }
      candidatesQueue[sessionId].push(candidate);
    }
  }

  function onPlayIceCandidate(sessionId, _candidate) {
    var candidate = kurento.register.complexTypes.IceCandidate(_candidate);
    var user = userRegistry.getById(sessionId);

    if (playPipelines[user.id] && playPipelines[user.id].webRtcEndpoint && playPipelines[user.id].webRtcEndpoint[user.id]) {
      var webRtcEndpoint = playPipelines[user.id].webRtcEndpoint[user.id];
      webRtcEndpoint.addIceCandidate(candidate);
    } else {
      if (!candidatesQueue[user.id]) {
        candidatesQueue[user.id] = [];
      }
      candidatesQueue[sessionId].push(candidate);
    }
  }


}
