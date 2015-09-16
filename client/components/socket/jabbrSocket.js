angular.module('jabbrApp')
  .factory('JabbrSocket', function() {
     console.log(io);
     var socket = io.connect('http://localhost:9000', {'forceNew': true});
     socket.on('firstContact', function(){
        console.log('Socket Connection Successful');
        startRecording= false;
     });
     return socket;
});