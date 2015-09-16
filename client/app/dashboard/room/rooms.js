'use strict';

angular.module('jabbrApp')
  .config(function ($stateProvider) {
    $stateProvider
      .state('roomId', {
        url: '/room',
        parent: 'dashboard',
        // parent: 'base',
        templateUrl: 'app/dashboard/room/views/room.html',
        controller: 'RoomCtrl',
        onExit: function(VideoStream, Room) {
          //console.log(VideoStream.userMedia)
          if(VideoStream.userMedia){
            VideoStream.userMedia.stop();
            VideoStream.userMedia = "";
            console.log("Exiting Room")
          }
          Room.leaveRoom();  // reset Room service variables
        }
      })
  });