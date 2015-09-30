'use strict';

angular.module('jabbrApp')
  .controller('RoomCtrl', function ($sce, $location, $stateParams, $scope, $state, Auth, Session, $http, User) {

$scope.partnerProfile = User.getProfile({id: $stateParams.partnerId});
$('#call').attr('disabled', true);
var ws = new WebSocket('ws://' + location.host + '/one2one');
$scope.ws = ws;
$scope.$on('$destroy', function() {
  console.log('closing')
  $scope.ws.close();
});
var videoInput;
var videoOutput;
var webRtcPeer;


var callState = null;
const NO_CALL = 0;
const PROCESSING_CALL = 1;
const IN_CALL = 2;
const DISABLED = 3;
const IN_PLAY = 4;
const POST_CALL = 5;
const CALL_READY = 6;

function setCallState(nextState) {
  switch (nextState) {
  case NO_CALL:
    var callBtn = $('#call');
    callBtn.attr('disabled', true);
    callBtn.html('<span class="glyphicon glyphicon-play"></span> Call</a>');
    callBtn.removeClass('btn-danger').addClass('btn-success');
    $('#callMessage').html(' - Not ready for call').css('color', 'red');
    break;
  case PROCESSING_CALL:
    $('#call').attr('disabled', true);
    $('#callMessage').empty();
    break;
  case IN_CALL:
    var callBtn = $('#call');
    callBtn.html('<span class="glyphicon glyphicon-stop"></span> End Call</a>');
    callBtn.removeClass( "btn-success" ).addClass( "btn-danger" );
    callBtn.attr('disabled', false);
    break;
  case DISABLED:
    $('#call').attr('disabled', true);
    break;
  case POST_CALL:
    var callBtn = $('#call');
    $('#callMessage').html(' - Ready for call').css('color', 'green');
    callBtn.html('<span class="glyphicon glyphicon-play"></span> Call</a>');
    callBtn.removeClass('btn-danger').addClass('btn-success');
    callBtn.attr('disabled', false);
    break;
  case CALL_READY:
    var $callMessage = $('#callMessage');
    var $callBtn = $('#call');
    $callMessage.html(' - Ready for call').css('color', 'green');
    $callBtn.attr('disabled', false);
  default:
    return;
  }
  callState = nextState;
}

  
  var drag = new Draggabilly(document.getElementById('videoSmall'));
  videoInput = document.getElementById('videoInput');
  videoOutput = document.getElementById('videoOutput');

  document.getElementById('call').addEventListener('click', function() {
    if(callState == IN_CALL) {
      stop();
    } else {
      call();
    }
  });

window.onbeforeunload = function() {
  ws.close();
}

ws.onmessage = function(message) {
  var parsedMessage = JSON.parse(message.data);
  console.info('Received message: ' + message.data);

  switch (parsedMessage.id) {
  case 'registerResponse':
    resgisterResponse(parsedMessage);
    break;
  case 'callResponse':
    callResponse(parsedMessage);
    break;
  case 'incomingCall':
    incomingCall(parsedMessage);
    break;
  case 'startCommunication':
    startCommunication(parsedMessage);
    break;
  case 'stopCommunication':
    console.info("Communication ended by remote peer");
    stop(true);
    break;
  case 'iceCandidate':
    webRtcPeer.addIceCandidate(parsedMessage.candidate)
    break;
  case 'playResponse':
    playResponse(parsedMessage);
    break;
  case 'playEnd':
    playEnd(parsedMessage);
    break;
  case 'partnerReady':
    setCallState(CALL_READY);
    break;
  case 'open':
    sendMessage({
      id: 'setUserId',
      name: $scope.currentUser.name,
      userId: $scope.currentUser._id,
      partnerId: $stateParams.partnerId
    });
    break;
  case 'userLeft':
    userLeft();
    break;
  default:
    console.error('Unrecognized message', parsedMessage);
  }
}

function resgisterResponse(message) {
  if (message.response == 'accepted') {
    setCallState(NO_CALL);
    console.log("Successfully registered");
    var checkMessage = {
      id: "checkReady",
      partnerId: $stateParams.partnerId
    };
    sendMessage(checkMessage);
  } else {
    var errorMessage = message.message ? message.message
        : 'Unknown reason for register rejection.';
    console.log(errorMessage);
    alert('Error registering user. See console for further information.');
  }
}

function callResponse(message) {
  if (message.response != 'accepted') {
    console.info('Call not accepted by peer. Closing call');
    var errorMessage = message.message ? message.message
        : 'Unknown reason for call rejection.';
    console.log(errorMessage);
    stop(true);
  } else {
    setCallState(IN_CALL);
    webRtcPeer.processAnswer(message.sdpAnswer);
  }
}

function startCommunication(message) {
  setCallState(IN_CALL);
  webRtcPeer.processAnswer(message.sdpAnswer);
}

function playResponse(message) {
  console.log("responding to play");
  if (message.response != 'accepted') {
    hideSpinner(videoOutput);
    document.getElementById('videoSmall').style.display = 'block';
    alert(message.error);
    document.getElementById('peer').focus();
    setCallState(POST_CALL);
  } else {
    setCallState(IN_PLAY);
    webRtcPeer.processAnswer(message.sdpAnswer, function(error) {
      if (error)
        return console.error(error);
      var message = {
        id: 'readyToPlay'
      };
      sendMessage(message);
    });
  }
}



function incomingCall(message) {
  // If bussy just reject without disturbing user

  if (callState != NO_CALL && callState != POST_CALL) {
    
    var response = {
      id : 'incomingCallResponse',
      from : $scope.currentUser._id,
      callResponse : 'reject',
      message : 'bussy'

    };
    return sendMessage(response);
  }

  setCallState(PROCESSING_CALL);
  if (confirm('User ' + message.fromName
      + ' is calling you. Do you accept the call?')) {
    showSpinner(videoInput, videoOutput);

    var options = {
      localVideo : videoInput,
      remoteVideo : videoOutput,
      onicecandidate : onIceCandidate
    }

    webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options,
        function(error) {
          if (error) {
            console.error(error);
            setCallState(NO_CALL);
          }

          this.generateOffer(function(error, offerSdp) {
            if (error) {
              console.error(error);
              setCallState(NO_CALL);
            }
            var response = {
              id : 'incomingCallResponse',
              from : message.from,
              callResponse : 'accept',
              sdpOffer : offerSdp
            };
            sendMessage(response);
          });
        });

  } else {
    var response = {
      id : 'incomingCallResponse',
      from : message.from,
      callResponse : 'reject',
      message : 'user declined'
    };
    sendMessage(response);
    stop(true);
  }
}

function register() {
  var name = document.getElementById('name').value;
  if (name == '') {
    window.alert("You must insert your user name");
    return;
  }

  var message = {
    id : 'register',
    name : name
  };
  sendMessage(message);
  document.getElementById('peer').focus();
}

function play() {

  document.getElementById('videoSmall').style.display = 'none';
  setCallState(DISABLED);
  showSpinner(videoOutput);

  var options = {
    remoteVideo : videoOutput,
    onicecandidate : onPlayIceCandidate
  }
  webRtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options,
      function(error) {
        if (error) {
          return console.error(error);
        }
        this.generateOffer(onOfferPlay);
      });
}

function onOfferPlay(error, offerSdp) {
  console.log('Invoking SDP offer callback function');
  var message = {
    id : 'play',
    user : document.getElementById('peer').value,
    sdpOffer : offerSdp
  };
  sendMessage(message);
}

function playEnd() {
  setCallState(POST_CALL);
  hideSpinner(videoInput, videoOutput);
  document.getElementById('videoSmall').style.display = 'block';
}

function call() {

  setCallState(PROCESSING_CALL);

  showSpinner(videoInput, videoOutput);

  var options = {
    localVideo : videoInput,
    remoteVideo : videoOutput,
    onicecandidate : onIceCandidate
  }

  webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function(
      error) {
    if (error) {
      console.error(error);
      setCallState(NO_CALL);
    }

    this.generateOffer(function(error, offerSdp) {
      if (error) {
        console.error(error);
        setCallState(NO_CALL);
      }
      var message = {
        id : 'call',
        from : $scope.currentUser._id,
        to : $stateParams.partnerId,
        sdpOffer : offerSdp
      };
      sendMessage(message);
    });
  });

}

function userLeft() {
  setCallState(NO_CALL);
  if (webRtcPeer) {
    webRtcPeer.dispose();
    webRtcPeer = null;
  }
  hideSpinner(videoInput, videoOutput);
  document.getElementById('videoSmall').style.display = 'block';
};

function stop(message) {
  setCallState(POST_CALL);
  if (webRtcPeer) {
    webRtcPeer.dispose();
    webRtcPeer = null;

    if (!message) {
      var message = {
        id : 'stop'
      }
      sendMessage(message);
    }
  }
  hideSpinner(videoInput, videoOutput);
  document.getElementById('videoSmall').style.display = 'block';
}

function sendMessage(message) {
  var jsonMessage = JSON.stringify(message);
  console.log('Sending message: ' + jsonMessage);
  ws.send(jsonMessage);
}

function onIceCandidate(candidate) {
  console.log('Local candidate' + JSON.stringify(candidate));

  var message = {
    id : 'onIceCandidate',
    candidate : candidate
  }
  sendMessage(message);
}

function onPlayIceCandidate(candidate) {
  console.log('Local candidate' + JSON.stringify(candidate));

  var message = {
    id : 'onPlayIceCandidate',
    candidate : candidate
  }
  sendMessage(message);
}

function showSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].poster = './images/transparent-1px.png';
    arguments[i].style.background = 'center transparent url("./images/spinner.gif") no-repeat';
  }
}

function hideSpinner() {
  for (var i = 0; i < arguments.length; i++) {
    arguments[i].src = '';
    arguments[i].poster = './images/webrtc.png';
    arguments[i].style.background = '';
  }
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
  event.preventDefault();
  $(this).ekkoLightbox();
});
});