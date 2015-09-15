angular.module('jabbrApp')
  .factory('JabbrSocket', function() {
     var socket = io.connect('http://' + location.host + ':9000', {'forceNew': true});
     socket.on('firstContact', function(){
        console.log('Socket Connection Successful');
        startRecording= false;
     });
     return socket;
});