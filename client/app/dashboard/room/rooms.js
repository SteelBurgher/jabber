'use strict';

angular.module('jabbrApp')
  .config(function ($stateProvider) {
    $stateProvider
      .state('roomId', {
        url: '/room',
        parent: 'dashboard',
        templateUrl: 'app/dashboard/room/views/room.html',
        params: {
          partnerId: undefined
        },
        controller: 'RoomCtrl'
      })
  });